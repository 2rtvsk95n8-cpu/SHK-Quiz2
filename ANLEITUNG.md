# Anlagenmechaniker Quizapp – Multiplayer mit Firebase und GitHub Pages

## Dateien
- index.html, app.js – die App
- fragen.js – die Fragen (hier kannst du Fragen ändern oder ergänzen)
- firebase-config.js – hier kommen deine Firebase-Daten rein
- database.rules.json – Sicherheitsregeln für die Datenbank (in Firebase einfügen)
- manifest.webmanifest, sw.js, icon-*.png – damit man die App auf dem Handy installieren kann

## 1. Firebase einrichten
1. console.firebase.google.com → Projekt erstellen (Google Analytics kann aus bleiben).
2. Build → Realtime Database → Datenbank erstellen → Standort Belgien (europe-west1) → im gesperrten Modus starten.
3. Reiter „Regeln“: alles löschen, Inhalt von database.rules.json einfügen, „Veröffentlichen“.
4. Build → Authentication → Jetzt starten → Anmeldemethode → „Anonym“ aktivieren.
5. Projektübersicht → Web-App hinzufügen (Symbol </>) → Namen eingeben → das angezeigte firebaseConfig-Objekt kopieren.
6. firebase-config.js öffnen und das Objekt dort ersetzen. Die Zeile databaseURL muss dabei sein.

## 2. Auf GitHub Pages hochladen
1. github.com → New repository → z. B. „quiz“ → Public → Create.
2. „uploading an existing file“ → alle Dateien aus diesem Ordner hineinziehen (nicht den Ordner selbst, nicht die ZIP) → Commit changes.
3. Settings → Pages → Source: „Deploy from a branch“ → Branch „main“, Ordner „/ (root)“ → Save.
4. Nach 1–2 Minuten ist die App erreichbar unter: https://DEIN-NAME.github.io/quiz/

## 3. Spielen
- Spielleitung (Laptop/Beamer): Seite öffnen → „Neues Spiel“ → PIN und QR-Code werden angezeigt.
- Spieler (Handy): QR-Code scannen oder Adresse öffnen, PIN und Namen eingeben.
- Die Spielleitung startet das Spiel und klickt sich durch Auflösung und Rangliste.
- Installieren auf dem Handy: im Browser-Menü „Zum Startbildschirm hinzufügen“.

## Wenn etwas nicht klappt
- „Firebase ist noch nicht eingerichtet“: firebase-config.js wurde nicht ausgefüllt oder nicht neu hochgeladen.
- „Anonyme Anmeldung ist nicht aktiviert“: Schritt 1.4 prüfen.
- „Zugriff verweigert“: Regeln aus database.rules.json veröffentlicht? (Schritt 1.3)
- Anmeldung scheitert trotzdem: Authentication → Einstellungen → Autorisierte Domains → DEIN-NAME.github.io hinzufügen.
- Änderungen erscheinen nicht: Seite neu laden, GitHub braucht nach dem Hochladen etwa eine Minute.
- Alte Spiele löschen: Realtime Database → Daten → Einträge unter „games“ und „secret“ entfernen.
