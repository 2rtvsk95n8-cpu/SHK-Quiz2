import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getDatabase, ref, get, set, update, remove, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { QUIZ, FRAGEN } from "./fragen.js";

// ------------------------------------------------------------
//  Zustand
// ------------------------------------------------------------
const app = document.getElementById("app");
const SESSION_KEY = "amq-session";
const S = {
  uid: null, offset: 0,
  view: "loading",            // loading | home | setup | join | host | player | message
  pin: null, game: undefined, deck: null,
  name: "", joinPin: "", error: "", message: null,
  setupCount: Math.min(20, FRAGEN.length), setupSecs: 25,
  busy: false, revealing: null, answeredIdx: null,
  lastKey: null, unsub: null
};
let db = null;
const now = () => Date.now() + S.offset;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ------------------------------------------------------------
//  Start: Firebase verbinden und anonym anmelden
// ------------------------------------------------------------
if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes("HIER")) {
  showMessage("Firebase ist noch nicht eingerichtet",
    "Trage deine Firebase-Daten in die Datei firebase-config.js ein und lade die Datei erneut hoch.");
} else {
  try {
    const fb = initializeApp(firebaseConfig);
    db = getDatabase(fb);
    const auth = getAuth(fb);
    onValue(ref(db, ".info/serverTimeOffset"), (s) => { S.offset = s.val() || 0; });
    onAuthStateChanged(auth, (user) => {
      if (user && !S.uid) { S.uid = user.uid; boot(); }
    });
    signInAnonymously(auth).catch((err) => {
      if (err.code === "auth/operation-not-allowed" || err.code === "auth/admin-restricted-operation") {
        showMessage("Anonyme Anmeldung ist nicht aktiviert",
          "Aktiviere sie in der Firebase-Konsole unter Authentication → Anmeldemethode → Anonym.");
      } else {
        showMessage("Anmeldung fehlgeschlagen", err.message);
      }
    });
  } catch (err) {
    showMessage("Firebase-Daten sind fehlerhaft",
      "Prüfe die Datei firebase-config.js. Meldung: " + err.message);
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

async function boot() {
  const urlPin = (new URLSearchParams(location.search).get("pin") || "").replace(/\D/g, "").slice(0, 5);
  let sess = null;
  try { sess = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) {}
  if (sess && (!urlPin || urlPin === sess.pin)) {
    const ok = await resume(sess).catch(() => false);
    if (ok) return;
    clearSession();
  }
  if (urlPin) { S.joinPin = urlPin; S.view = "join"; } else { S.view = "home"; }
  render();
}

// Nach Neuladen der Seite wieder ins laufende Spiel zurückkehren
async function resume(sess) {
  const snap = await get(ref(db, "games/" + sess.pin));
  if (!snap.exists()) return false;
  const g = snap.val();
  if (sess.role === "host" && g.hostId === S.uid && g.status !== "done") {
    const sec = await get(ref(db, "secret/" + sess.pin));
    if (!sec.exists()) return false;
    S.deck = sec.val().deck;
    attach("host", sess.pin);
    return true;
  }
  if (sess.role === "player" && g.players && g.players[S.uid]) {
    S.name = g.players[S.uid].name;
    attach("player", sess.pin);
    return true;
  }
  return false;
}

function saveSession(data) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch (e) {} }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

function attach(role, pin) {
  detach();
  S.view = role; S.pin = pin; S.game = undefined; S.lastKey = null;
  saveSession({ role, pin });
  S.unsub = onValue(ref(db, "games/" + pin), (snap) => {
    S.game = snap.val();
    if (!S.game) { gameGone(); return; }
    render();
  }, (err) => showMessage("Keine Verbindung zum Spiel", errorText(err)));
}

function detach() { if (S.unsub) { S.unsub(); S.unsub = null; } }

function gameGone() {
  const wasPlayer = S.view === "player";
  detach(); clearSession();
  S.game = null; S.pin = null;
  if (wasPlayer) {
    showMessage("Das Spiel wurde beendet", "Die Spielleitung hat das Spiel geschlossen.");
  } else {
    goHome();
  }
}

// ------------------------------------------------------------
//  Hilfsfunktionen
// ------------------------------------------------------------
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

function buildDeck(count) {
  return shuffle(FRAGEN).slice(0, count).map((f) => {
    const order = shuffle([0, 1, 2, 3]);
    return { c: f.c, q: f.q, e: f.e, o: order.map((i) => f.o[i]), a: order.indexOf(f.a) };
  });
}

function playerList(g) {
  return Object.entries((g && g.players) || {})
    .map(([id, p]) => ({ id, name: p.name, score: p.score || 0, streak: p.streak || 0, last: p.last }))
    .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name, "de"));
}

function rankOf(list, score) { return 1 + list.filter((p) => p.score > score).length; }

function answersFor(g, idx) { return (g.answers && g.answers[idx]) || {}; }

function remainingMs(g) {
  if (typeof g.start !== "number") return g.secs * 1000;
  return Math.max(0, g.start + g.secs * 1000 - now());
}

function errorText(e) {
  if (e && e.userMessage) return e.userMessage;
  const t = String((e && (e.code || e.message)) || e).toLowerCase();
  if (t.includes("permission")) return "Zugriff verweigert. Prüfe die Regeln der Realtime Database (Inhalt der Datei database.rules.json).";
  if (t.includes("network") || t.includes("offline")) return "Keine Internetverbindung.";
  return "Das hat nicht geklappt: " + ((e && e.message) || e);
}

function userError(msg) { const e = new Error(msg); e.userMessage = msg; return e; }

function toast(msg) {
  const t = document.createElement("div");
  t.setAttribute("role", "status");
  t.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#f2f2f5;color:#101018;padding:12px 18px;border-radius:12px;font-weight:500;z-index:50;max-width:calc(100% - 32px)";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

const shape = (i, txt, extra = "") =>
  `<div class="ans a${i}" ${extra}><span class="shape" aria-hidden="true"></span><span class="txt">${esc(txt)}</span></div>`;

function top(right = "") {
  return `<header class="top"><div class="brand"><div class="logo" aria-hidden="true">A</div>
    <div class="brand-name">${esc(QUIZ.titel)}</div></div>${right}</header>`;
}

function showMessage(title, text) {
  detach();
  S.view = "message"; S.message = { title, text };
  render();
}

function goHome() {
  detach(); clearSession();
  S.view = "home"; S.pin = null; S.game = undefined; S.deck = null; S.error = ""; S.busy = false;
  if (location.search) history.replaceState(null, "", location.pathname);
  render();
}

// ------------------------------------------------------------
//  Anzeige
// ------------------------------------------------------------
function render() {
  const v = currentView();
  if (v.key !== S.lastKey) {
    app.innerHTML = v.html();
    S.lastKey = v.key;
    if (v.bind) v.bind();
  }
  if (v.patch) v.patch();
}

function currentView() {
  switch (S.view) {
    case "home": return homeView();
    case "setup": return setupView();
    case "join": return joinView();
    case "message": return messageView();
    case "host": return S.game ? hostView(S.game) : loadingView();
    case "player": return S.game ? playerView(S.game) : loadingView();
    default: return loadingView();
  }
}

function loadingView() {
  return { key: "loading", html: () => `${top()}<p class="muted center" style="margin-top:40px">Verbinde …</p>` };
}

function messageView() {
  const m = S.message || {};
  return {
    key: "msg-" + m.title + m.text,
    html: () => `${top()}<section class="panel narrow" style="margin:30px auto 0">
      <h2>${esc(m.title)}</h2><p class="muted" style="margin-top:10px">${esc(m.text)}</p>
      <button class="btn" style="margin-top:22px" data-act="reload">Seite neu laden</button></section>`
  };
}

function homeView() {
  return {
    key: "home",
    html: () => `${top()}
    <div class="home">
      <section class="panel">
        <p class="kicker">${esc(QUIZ.kapitel)}</p>
        <h1>${esc(QUIZ.thema)}</h1>
        <p class="lead">${FRAGEN.length} Fragen aus dem Arbeitsblatt. Alle spielen gleichzeitig auf dem Handy. Wer schneller richtig antwortet, bekommt mehr Punkte, dazu gibt es einen Bonus für Serien.</p>
      </section>
      <div class="choice">
        <div class="panel"><h3>Spiel leiten</h3>
          <p class="muted">Am Laptop oder Beamer: Spiel erstellen, PIN zeigen und die Fragen steuern.</p>
          <button class="btn" data-act="toSetup">Neues Spiel</button></div>
        <div class="panel"><h3>Mitspielen</h3>
          <p class="muted">Am Handy: PIN eingeben oder den QR-Code der Spielleitung scannen.</p>
          <button class="btn light" data-act="toJoin">Spiel beitreten</button></div>
      </div>
    </div>`
  };
}

function setupView() {
  return {
    key: "setup",
    html: () => `${top()}
    <section class="panel narrow stack" style="margin:0 auto">
      <h2>Neues Spiel</h2>
      <label class="field"><span>Anzahl Fragen: <b data-out="count"></b> von ${FRAGEN.length}</span>
        <input type="range" min="5" max="${FRAGEN.length}" step="1" value="${S.setupCount}" data-model="setupCount"></label>
      <label class="field"><span>Zeit pro Frage: <b data-out="secs"></b> Sekunden</span>
        <input type="range" min="10" max="60" step="5" value="${S.setupSecs}" data-model="setupSecs"></label>
      <p class="error" data-out="error"></p>
      <div class="row"><button class="btn" data-act="createGame" data-busy>Spiel erstellen</button>
        <button class="btn ghost" data-act="goHome">Zurück</button></div>
    </section>`,
    patch: () => {
      setOut("count", S.setupCount); setOut("secs", S.setupSecs); setOut("error", S.error);
      app.querySelectorAll("[data-busy]").forEach((b) => { b.disabled = S.busy; });
    }
  };
}

function joinView() {
  return {
    key: "join",
    html: () => `${top()}
    <section class="panel narrow stack" style="margin:0 auto">
      <h2>Spiel beitreten</h2>
      <label class="field"><span>Spiel-PIN</span>
        <input class="input pin" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="00000" value="${esc(S.joinPin)}" data-model="joinPin"></label>
      <label class="field"><span>Dein Name</span>
        <input class="input" maxlength="20" autocomplete="nickname" placeholder="z. B. Lena" value="${esc(S.name)}" data-model="name"></label>
      <p class="error" data-out="error"></p>
      <button class="btn block" data-act="join" data-busy>Beitreten</button>
      <button class="btn ghost block" data-act="goHome">Zurück</button>
    </section>`,
    bind: () => {
      const target = S.joinPin.length === 5 ? '[data-model="name"]' : '[data-model="joinPin"]';
      const el = app.querySelector(target);
      if (el && window.matchMedia("(min-width: 761px)").matches) el.focus();
    },
    patch: () => {
      setOut("error", S.error);
      app.querySelectorAll("[data-busy]").forEach((b) => { b.disabled = S.busy; });
    }
  };
}

function setOut(name, value) {
  app.querySelectorAll(`[data-out="${name}"]`).forEach((el) => {
    const v = String(value ?? "");
    if (el.textContent !== v) el.textContent = v;
  });
}

// ---------- Spielleitung ----------
function hostView(g) {
  const players = playerList(g);
  const hostTop = top(`<div class="chip"><small>PIN</small>${esc(S.pin)}</div>`);
  const cur = g.current || {};
  const total = g.total;

  if (g.status === "lobby") {
    const joinUrl = location.origin + location.pathname + "?pin=" + S.pin;
    const shortUrl = (location.host + location.pathname).replace(/index\.html$/, "");
    return {
      key: "host-lobby",
      html: () => `${hostTop}
      <div class="lobby">
        <section class="panel">
          <p class="muted">Handy nehmen, <b>${esc(shortUrl)}</b> öffnen und diese PIN eingeben:</p>
          <div class="pin-big">${esc(S.pin)}</div>
          <div class="bar-foot">
            <h3 data-out="pcount" style="margin:0"></h3>
            <div class="row"><button class="btn ghost" data-act="cancelGame">Abbrechen</button>
              <button class="btn" data-act="startGame" data-start>Spiel starten</button></div>
          </div>
          <div class="players" data-players aria-live="polite"></div>
        </section>
        <aside class="qr-card">
          <h3>Mit dem Handy beitreten</h3>
          <p style="font-size:13px;color:rgba(16,16,24,.62)">QR-Code scannen, die PIN ist dann schon eingetragen.</p>
          <canvas data-qr width="220" height="220" aria-label="QR-Code zum Beitreten"></canvas>
          <div class="qr-url">${esc(joinUrl)}</div>
        </aside>
      </div>`,
      bind: () => {
        const c = app.querySelector("[data-qr]");
        if (c && window.QRious) {
          try { new window.QRious({ element: c, value: joinUrl, size: 440, padding: 12, level: "M", background: "#ffffff", foreground: "#101018" }); } catch (e) {}
        }
      },
      patch: () => {
        const n = players.length;
        setOut("pcount", n === 0 ? "Noch niemand beigetreten" : n === 1 ? "1 Spieler dabei" : `${n} Spieler dabei`);
        const btn = app.querySelector("[data-start]");
        if (btn) btn.disabled = n === 0 || S.busy;
        const box = app.querySelector("[data-players]");
        if (!box) return;
        const ids = new Set(players.map((p) => p.id));
        box.querySelectorAll("[data-id]").forEach((el) => { if (!ids.has(el.dataset.id)) el.remove(); });
        players.slice().sort((a, b) => a.name.localeCompare(b.name, "de")).forEach((p) => {
          if (!box.querySelector(`[data-id="${CSS.escape(p.id)}"]`)) {
            const chip = document.createElement("span");
            chip.className = "player-chip"; chip.dataset.id = p.id; chip.textContent = p.name;
            box.appendChild(chip);
          }
        });
      }
    };
  }

  if (g.status === "question") {
    return {
      key: "host-q-" + g.idx,
      html: () => `${hostTop}
      <div class="meta"><span>Frage ${g.idx + 1} von ${total}</span><span>${esc(cur.c)}</span></div>
      <div class="progress"><div style="width:${(g.idx / total) * 100}%"></div></div>
      <section class="qpanel"><h2>${esc(cur.q)}</h2>
        <div class="timer"><div class="timer-track"><div class="timer-bar" data-bar></div></div><div class="timer-num" data-num></div></div>
      </section>
      <div class="answers">${(cur.o || []).map((t, i) => shape(i, t)).join("")}</div>
      <div class="bar-foot"><p class="muted" data-out="answered"></p>
        <button class="btn" data-act="reveal">Jetzt auflösen</button></div>`,
      patch: () => {
        const rem = remainingMs(g);
        updateTimer(rem, g.secs);
        const answered = Object.keys(answersFor(g, g.idx)).filter((id) => g.players && g.players[id]).length;
        setOut("answered", `${answered} von ${players.length} haben geantwortet`);
        if (rem <= 0 || (players.length > 0 && answered >= players.length)) reveal();
      }
    };
  }

  if (g.status === "reveal") {
    const rv = g.reveal || { counts: [0, 0, 0, 0] };
    return {
      key: "host-r-" + g.idx,
      html: () => `${hostTop}
      <div class="meta"><span>Frage ${g.idx + 1} von ${total}</span><span>${esc(cur.c)}</span></div>
      <div class="progress"><div style="width:${((g.idx + 1) / total) * 100}%"></div></div>
      <section class="qpanel"><h2>${esc(cur.q)}</h2></section>
      <div class="answers">${(cur.o || []).map((t, i) =>
        `<div class="ans a${i} ${i === rv.a ? "right" : "dim"}"><span class="shape" aria-hidden="true"></span><span class="txt">${esc(t)}</span><span class="count">${(rv.counts && rv.counts[i]) || 0}</span></div>`).join("")}</div>
      <div class="reveal"><div>
          <h3 style="color:var(--good)">Richtig: ${esc((cur.o || [])[rv.a])}</h3>
          <p class="muted">${esc(rv.e)}</p></div>
        <button class="btn light" data-act="showBoard">Rangliste zeigen</button></div>`
    };
  }

  if (g.status === "leaderboard") {
    const last = g.idx + 1 >= total;
    return {
      key: "host-b-" + g.idx,
      html: () => `${hostTop}
      <section class="panel" style="max-width:680px;margin:0 auto">
        <p class="kicker">Nach Frage ${g.idx + 1} von ${total}</p>
        <h2>Rangliste</h2>
        ${boardHtml(players.slice(0, 5), players)}
        <div class="row" style="justify-content:flex-end;margin-top:10px">
          ${last ? "" : `<button class="btn ghost" data-act="endGame">Spiel beenden</button>`}
          <button class="btn" data-act="nextQ">${last ? "Endergebnis zeigen" : "Nächste Frage"}</button></div>
      </section>`
    };
  }

  // Endergebnis
  return {
    key: "host-done",
    html: () => `${hostTop}
    <section class="center" style="max-width:760px;margin:0 auto">
      <p class="kicker">Endergebnis</p>
      <h1>${players.length ? "Glückwunsch, " + esc(players[0].name) + "!" : "Spiel beendet"}</h1>
      ${podiumHtml(players)}
      <div style="text-align:left">${players.length > 3 ? boardHtml(players.slice(3), players) : ""}</div>
      <div class="row" style="justify-content:center;margin-top:22px">
        <button class="btn" data-act="newGame">Neues Spiel</button>
        <button class="btn ghost" data-act="closeGame">Schließen</button></div>
    </section>`
  };
}

function updateTimer(rem, secs) {
  const bar = app.querySelector("[data-bar]");
  const num = app.querySelector("[data-num]");
  const pct = Math.max(0, Math.min(100, (rem / (secs * 1000)) * 100));
  if (bar) { bar.style.width = pct + "%"; bar.classList.toggle("low", pct < 30); }
  if (num) num.textContent = Math.ceil(rem / 1000);
}

function boardHtml(rows, all, meId = null) {
  if (!rows.length) return `<p class="muted" style="margin-top:14px">Noch keine Spieler.</p>`;
  return `<ol class="board">${rows.map((p) => `
    <li class="${p.id === meId ? "me" : ""}"><span class="rank">${rankOf(all, p.score)}.</span>
      <span class="who">${esc(p.name)}</span><span class="pts">${p.score}</span></li>`).join("")}</ol>`;
}

function podiumHtml(players) {
  const slot = (p, cls) => p
    ? `<div class="step ${cls}"><div class="who">${esc(p.name)}</div><div class="pts">${p.score} Punkte</div><div class="place">${rankOf(players, p.score)}</div></div>`
    : `<div aria-hidden="true"></div>`;
  return `<div class="podium">${slot(players[1], "p2")}${slot(players[0], "p1")}${slot(players[2], "p3")}</div>`;
}

// ---------- Spieler ----------
function playerView(g) {
  const players = playerList(g);
  const me = players.find((p) => p.id === S.uid);
  if (!me) {
    return {
      key: "p-gone",
      html: () => `${top()}<section class="panel narrow" style="margin:30px auto 0"><h2>Du bist nicht mehr in diesem Spiel</h2>
        <button class="btn" style="margin-top:20px" data-act="goHome">Zur Startseite</button></section>`
    };
  }
  const pTop = top(`<div class="chip"><small>${esc(me.name)}</small>${me.score}</div>`);
  const cur = g.current || {};
  const total = g.total;
  const rank = rankOf(players, me.score);

  if (g.status === "lobby") {
    return {
      key: "p-lobby",
      html: () => `${pTop}
      <section class="panel narrow center" style="margin:30px auto 0">
        <p class="kicker">Spiel ${esc(S.pin)}</p>
        <h2>Du bist dabei, ${esc(me.name)}!</h2>
        <p class="muted" style="margin-top:10px">Gleich startet die Spielleitung das Quiz.</p>
        <p class="muted" style="margin-top:6px" data-out="pcount"></p>
        <button class="btn ghost" style="margin-top:22px" data-act="leave">Spiel verlassen</button>
      </section>`,
      patch: () => setOut("pcount", players.length === 1 ? "Bisher bist nur du da." : `${players.length} Spieler warten.`)
    };
  }

  if (g.status === "question") {
    const mine = answersFor(g, g.idx)[S.uid];
    const rem = remainingMs(g);
    const state = mine ? "done" : rem <= 0 ? "late" : "open";
    const head = `<div class="meta"><span>Frage ${g.idx + 1} von ${total}</span><span>${esc(cur.c)}</span></div>`;
    return {
      key: `p-q-${g.idx}-${state}-${me.score}`,
      html: () => {
        if (state === "open") {
          return `${pTop}${head}
          <section class="qpanel"><h2 style="font-size:clamp(20px,5vw,28px)">${esc(cur.q)}</h2>
            <div class="timer"><div class="timer-track"><div class="timer-bar" data-bar></div></div><div class="timer-num" data-num></div></div></section>
          <div class="answers phone">${(cur.o || []).map((t, i) =>
            `<button class="ans a${i}" data-act="answer" data-arg="${i}"><span class="shape" aria-hidden="true"></span><span class="txt">${esc(t)}</span></button>`).join("")}</div>`;
        }
        if (state === "done") {
          return `${pTop}
          <section class="panel narrow center" style="margin:24px auto 0">
            <p class="kicker">Frage ${g.idx + 1} von ${total}</p>
            <h2>Antwort gespeichert</h2>
            <div style="margin-top:18px;text-align:left">${shape(mine.c, (cur.o || [])[mine.c])}</div>
            <p class="muted" style="margin-top:16px">Warte auf die Auflösung …</p>
          </section>`;
        }
        return `${pTop}
          <section class="panel narrow center" style="margin:24px auto 0">
            <p class="kicker">Frage ${g.idx + 1} von ${total}</p>
            <h2>Zeit abgelaufen</h2>
            <p class="muted" style="margin-top:12px">Warte auf die Auflösung …</p>
          </section>`;
      },
      patch: () => { if (state === "open") updateTimer(rem, g.secs); }
    };
  }

  if (g.status === "reveal") {
    const rv = g.reveal || {};
    const last = me.last && me.last.idx === g.idx ? me.last : null;
    const ok = last && last.ok;
    const verdict = ok ? "Richtig!" : last && last.c >= 0 ? "Leider falsch" : "Keine Antwort";
    return {
      key: `p-r-${g.idx}-${me.score}-${ok ? 1 : 0}`,
      html: () => `${pTop}
      <section class="panel narrow center" style="margin:18px auto 0">
        <p class="kicker">Frage ${g.idx + 1} von ${total}</p>
        <div class="verdict ${ok ? "good" : "bad"}">${verdict}</div>
        ${ok ? `<p class="phone-big" style="margin-top:10px">+${last.pts}</p>` : ""}
        ${ok && me.streak >= 2 ? `<p class="muted" style="margin-top:8px">${me.streak} richtige Antworten in Folge</p>` : ""}
        <div style="margin-top:20px;text-align:left">
          <p class="muted" style="margin-bottom:8px">Richtige Antwort</p>
          ${shape(rv.a, (cur.o || [])[rv.a])}
          <p class="muted" style="margin-top:14px">${esc(rv.e)}</p>
        </div>
      </section>`
    };
  }

  if (g.status === "leaderboard") {
    const ahead = players.filter((p) => p.score > me.score).sort((a, b) => a.score - b.score)[0];
    return {
      key: `p-b-${g.idx}-${me.score}-${rank}`,
      html: () => `${pTop}
      <section class="panel narrow center" style="margin:24px auto 0">
        <p class="kicker">Zwischenstand nach Frage ${g.idx + 1}</p>
        <p class="phone-big">Platz ${rank}</p>
        <p class="lead" style="margin:12px auto 0">${me.score} Punkte, ${players.length} Spieler im Spiel.</p>
        ${ahead ? `<p class="muted" style="margin-top:8px">Noch ${ahead.score - me.score} Punkte bis Platz ${rankOf(players, ahead.score)}.</p>`
                : `<p style="margin-top:8px;color:var(--good)">Du führst!</p>`}
      </section>`
    };
  }

  return {
    key: `p-done-${me.score}-${rank}`,
    html: () => `${pTop}
    <section class="panel narrow center" style="margin:24px auto 0">
      <p class="kicker">Endergebnis</p>
      <p class="phone-big">Platz ${rank}</p>
      <p class="lead" style="margin:12px auto 0">${me.score} Punkte von ${players.length} Spielern.</p>
      <div style="text-align:left">${boardHtml(players.slice(0, 3), players, S.uid)}</div>
      <button class="btn" style="margin-top:14px" data-act="closeGame">Zur Startseite</button>
    </section>`
  };
}

// ------------------------------------------------------------
//  Aktionen
// ------------------------------------------------------------
async function createGame() {
  if (S.busy) return;
  S.busy = true; S.error = ""; render();
  try {
    const deck = buildDeck(Number(S.setupCount));
    const secs = Number(S.setupSecs);
    let pin = null, denied = 0;
    for (let i = 0; i < 8 && !pin; i++) {
      const p = String(10000 + Math.floor(Math.random() * 90000));
      if ((await get(ref(db, "games/" + p))).exists()) continue;
      try {
        await set(ref(db, "secret/" + p), { hostId: S.uid, deck });
        await set(ref(db, "games/" + p), { hostId: S.uid, status: "lobby", total: deck.length, secs, idx: 0, createdAt: serverTimestamp() });
        pin = p;
      } catch (e) {
        if (!String(e.code || e.message).toLowerCase().includes("permission")) throw e;
        denied++;
      }
    }
    if (!pin) throw denied ? new Error("permission_denied") : userError("Keine freie PIN gefunden. Bitte noch einmal versuchen.");
    S.deck = deck; S.busy = false; S.revealing = null;
    attach("host", pin);
  } catch (e) {
    S.busy = false; S.error = errorText(e); render();
  }
}

async function join() {
  if (S.busy) return;
  const pin = String(S.joinPin || "").replace(/\D/g, "");
  let name = String(S.name || "").trim().slice(0, 20);
  if (pin.length !== 5) { S.error = "Die PIN hat 5 Ziffern."; render(); return; }
  if (!name) { S.error = "Gib deinen Namen ein."; render(); return; }
  S.busy = true; S.error = ""; render();
  try {
    const snap = await get(ref(db, "games/" + pin));
    if (!snap.exists()) throw userError("Kein Spiel mit dieser PIN gefunden. Prüfe die Ziffern.");
    const g = snap.val();
    if (g.status === "done") throw userError("Dieses Spiel ist schon vorbei.");
    const existing = g.players && g.players[S.uid];
    if (existing) {
      name = existing.name;
    } else {
      const taken = Object.values(g.players || {}).some((p) => p.name.toLowerCase() === name.toLowerCase());
      if (taken) throw userError("Dieser Name ist in dem Spiel schon vergeben.");
      await set(ref(db, `games/${pin}/players/${S.uid}`), { name, score: 0, streak: 0 });
    }
    S.busy = false; S.name = name; S.answeredIdx = null;
    if (location.search) history.replaceState(null, "", location.pathname);
    attach("player", pin);
  } catch (e) {
    S.busy = false; S.error = errorText(e); render();
  }
}

async function startQuestion(idx) {
  const q = S.deck[idx];
  S.revealing = null;
  await update(ref(db, "games/" + S.pin), {
    status: "question", idx, current: { c: q.c, q: q.q, o: q.o }, start: serverTimestamp(), reveal: null
  });
}

// Auflösen: Punkte berechnen (nur die Spielleitung kennt die richtige Antwort)
async function reveal() {
  const g = S.game;
  if (!g || g.status !== "question" || S.revealing === g.idx) return;
  const idx = g.idx;
  S.revealing = idx;
  const q = S.deck[idx];
  const ans = answersFor(g, idx);
  const limit = g.secs * 1000;
  const deadline = (typeof g.start === "number" ? g.start : now()) + limit;
  const counts = [0, 0, 0, 0];
  const up = {};
  for (const [id, p] of Object.entries(g.players || {})) {
    const a = ans[id];
    const valid = a && typeof a.c === "number" && a.c >= 0 && a.c < 4 && typeof a.t === "number" && a.t <= deadline + 1500;
    if (valid) counts[a.c]++;
    const ok = !!valid && a.c === q.a;
    const streak = ok ? (p.streak || 0) + 1 : 0;
    const speed = ok ? Math.max(0, Math.min(1, (deadline - a.t) / limit)) : 0;
    const pts = ok ? Math.round(600 + 400 * speed) + Math.min(streak - 1, 5) * 50 : 0;
    up[`players/${id}/score`] = (p.score || 0) + pts;
    up[`players/${id}/streak`] = streak;
    up[`players/${id}/last`] = { idx, ok, pts, c: valid ? a.c : -1 };
  }
  up.status = "reveal";
  up.reveal = { a: q.a, e: q.e, counts };
  try {
    await update(ref(db, "games/" + S.pin), up);
  } catch (e) {
    S.revealing = null;
    toast(errorText(e));
  }
}

async function removeGame() {
  const pin = S.pin;
  detach(); clearSession();
  S.game = undefined; S.pin = null; S.deck = null;
  try { await remove(ref(db, "games/" + pin)); } catch (e) {}
  try { await remove(ref(db, "secret/" + pin)); } catch (e) {}
}

const actions = {
  reload: () => location.reload(),
  goHome,
  toSetup: () => { S.view = "setup"; S.error = ""; render(); },
  toJoin: () => { S.view = "join"; S.error = ""; render(); },
  createGame,
  join,
  startGame: () => startQuestion(0).catch((e) => toast(errorText(e))),
  reveal: () => reveal(),
  showBoard: () => update(ref(db, "games/" + S.pin), { status: "leaderboard" }).catch((e) => toast(errorText(e))),
  nextQ: () => {
    const g = S.game;
    const p = g.idx + 1 < g.total ? startQuestion(g.idx + 1) : update(ref(db, "games/" + S.pin), { status: "done" });
    p.catch((e) => toast(errorText(e)));
  },
  endGame: () => update(ref(db, "games/" + S.pin), { status: "done" }).catch((e) => toast(errorText(e))),
  cancelGame: async () => { await removeGame(); goHome(); },
  // Beendete Spiele bleiben stehen, damit die Spieler ihr Ergebnis weiter sehen
  newGame: () => { detach(); clearSession(); S.game = undefined; S.pin = null; S.deck = null; S.view = "setup"; S.error = ""; render(); },
  closeGame: () => goHome(),
  leave: async () => {
    const pin = S.pin;
    detach(); clearSession();
    try { await remove(ref(db, `games/${pin}/players/${S.uid}`)); } catch (e) {}
    goHome();
  },
  answer: (arg) => {
    const g = S.game;
    if (!g || g.status !== "question" || S.answeredIdx === g.idx || remainingMs(g) <= 0) return;
    const idx = g.idx;
    S.answeredIdx = idx;
    set(ref(db, `games/${S.pin}/answers/${idx}/${S.uid}`), { c: Number(arg), t: serverTimestamp() })
      .catch(() => { if (S.answeredIdx === idx) S.answeredIdx = null; render(); });
  }
};

app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el.dataset.arg, el);
});

app.addEventListener("input", (e) => {
  const m = e.target.dataset && e.target.dataset.model;
  if (!m) return;
  if (m === "joinPin") e.target.value = e.target.value.replace(/\D/g, "").slice(0, 5);
  S[m] = e.target.value;
  S.error = "";
  render();
});

app.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && S.view === "join" && e.target.dataset && e.target.dataset.model) join();
});

// Timer und automatische Auflösung
setInterval(() => {
  if (S.game && S.game.status === "question" && (S.view === "host" || S.view === "player")) render();
}, 100);
