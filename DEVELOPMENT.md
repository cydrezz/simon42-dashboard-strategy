# Entwickler-Anleitung

## Wie arbeite ich mit diesem Setup?

Du hast zwei Container:
1. **Home Assistant Container:** Hier läuft dein Smart Home (das "Haus").
2. **Dev Container (dieses Projekt):** Hier ist deine Werkstatt mit allen Werkzeugen (Node.js, Prüf-Tools).

### Schritt 1: Entwicklungsumgebung starten
1. Öffne diesen Ordner in VS Code.
2. Klicke unten links auf das grüne Symbol `><` und wähle **"Reopen in Container"**.
3. Warte, bis alles geladen ist.

### Schritt 2: Live-Server starten
Im VS Code Terminal innerhalb des Containers:
```bash
npm start
```
Das startet einen Webserver auf Port 8080. Deine Dateien sind nun unter `http://DEINE-PC-IP:8080` erreichbar.

### Schritt 3: Mit Home Assistant verbinden (Live-Link)
Damit du Änderungen sofort siehst, ohne Dateien kopieren zu müssen:

1. Gehe in dein Home Assistant Dashboard.
2. Gehe zu **Einstellungen** -> **Dashboards** -> **Ressourcen**.
3. Füge eine neue Ressource hinzu (oder bearbeite die bestehende simon42 Ressource):
   - **URL:** `http://DEINE-WINDOWS-IP:8080/simon42-strategies-loader.js`
     *(Ersetze `DEINE-WINDOWS-IP` mit der echten IP deines Computers, z.B. 192.168.178.20)*
   - **Typ:** JavaScript Modul

### Schritt 4: Arbeiten
1. Ändere eine Datei in VS Code (z.B. in `dist/cards/`).
2. Speichere die Datei (STRG+S).
3. Lade dein Home Assistant Dashboard im Browser neu.
4. Die Änderung ist sofort sichtbar!

### Fehlerprüfung
VS Code zeigt dir nun automatisch Fehler (rote Linien) an, wenn du JavaScript-Regeln verletzt. Das hilft dir, sauberen Code zu schreiben.
