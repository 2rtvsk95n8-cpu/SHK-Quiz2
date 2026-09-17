# Anlagenmechaniker Quizapp

Kahoot-artiges Quiz zu **Lernfeld 5, Kapitel 5.4 – Technische Regeln für
Trinkwasser-Installationen**. 50 Fragen mit je vier Antworten, 25 Sekunden pro
Frage, Punkte nach Antwortgeschwindigkeit plus Serien-Bonus.

Die App wird über GitHub Pages ausgeliefert. Für die Live-Synchronisation nutzt
sie die Firebase Realtime Database, sobald `docs/firebase-config.js` ausgefüllt
ist – andernfalls automatisch einen öffentlichen MQTT-Broker (ohne Konfiguration).

## Funktionen
- Einzelmodus und Teammodus (vier Teams, max. 4 Spieler pro Team)
- Ein fester Raum `TW54` – kein Code nötig, Beitritt per QR-Code
- Live-Anzeige von Teambesetzung und Punktestand auf allen Geräten
- Nur die Spielleitung kann das Quiz starten und die Lobby leeren
- Erklärung zur richtigen Antwort nach jeder Frage, Teamwertung am Ende

## Projektstruktur
```
Anlagenmechaniker Quizapp.dc.html   Quelldatei (zum Weiterentwickeln)
docs/index.html                     fertige App für GitHub Pages
docs/firebase-config.js             Firebase-Zugangsdaten (optional)
docs/database.rules.json            Regeln zum Einfügen in die Realtime Database
docs/.nojekyll
.github/workflows/pages.yml         Auto-Deploy bei Push auf main
```

## Deployment
1. Repository anlegen und die Dateien pushen.
2. **Settings → Pages → Source: GitHub Actions**
   (alternativ *Deploy from branch*, Branch `main`, Ordner `/docs`).
3. App läuft unter `https://<user>.github.io/<repo>/`.

## Firebase einrichten (optional, empfohlen im Schulnetz)
1. Realtime Database im Firebase-Projekt anlegen (Standort Europa).
2. Reiter **Regeln**: Inhalt von `docs/database.rules.json` einfügen und veröffentlichen.
   Die App speichert alles unter `rooms/TW54`.
3. **Authentication → Anmeldemethode → Anonym** aktivieren.
4. **Authentication → Einstellungen → Autorisierte Domains**: die Pages-Domain
   (z. B. `<user>.github.io`) hinzufügen.
5. `docs/firebase-config.js` mit den Werten der Web-App füllen (`export` stehen
   lassen, `databaseURL` muss enthalten sein) und committen.

Es werden nur Name und Punktestand übertragen – am besten nur Vornamen oder
Spitznamen eingeben lassen.

## Nutzung im Unterricht
1. Lehrkraft öffnet die Seite und klickt **Raum leiten · Teams**.
2. Schüler scannen den QR-Code aus der Lobby, geben ihren Namen ein und wählen
   ein Team.
3. Lehrkraft startet mit **Quiz für alle starten**.

Die Statusanzeige in der Lobby zeigt „Online verbunden“. Erscheint dort
„Offline – nur dieses Gerät“, sind weder Firebase noch der MQTT-Broker
erreichbar; dann funktioniert die Synchronisation nur zwischen Tabs desselben
Geräts.

## Quelle der Fragen
Musterlösung zum Arbeitsblatt Kapitel 5.4. Formulierungen können vom Fachbuch
abweichen.
