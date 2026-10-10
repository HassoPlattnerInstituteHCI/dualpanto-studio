# DualPanto Studio (Prototyp v0.1)

Ein Online-Editor für DualPanto-Apps und -Spiele: Level zeichnen, JavaScript schreiben, im Emulator oder direkt auf dem Gerät testen. Unity braucht man dafür nicht.

## Starten

Die App besteht nur aus statischen Dateien und hat keinen Build-Schritt. Wegen der ES-Module muss sie über einen kleinen Webserver laufen, `file://` funktioniert nicht:

```bash
cd dualpanto-studio
python3 serve.py          # öffnet http://localhost:8000 im Browser
```

`serve.py` schaltet das Caching ab, damit nach einer Änderung sicher die neue Version geladen wird. `python3 -m http.server`, `npx serve` oder „Live Server“ in VS Code funktionieren auch – dort hilft bei alten Ständen ein harter Reload (Strg/⌘ + Umschalt + R).

Beim Start schreibt die Konsole unten rechts den Stand der Software, zum Beispiel „Willkommen im DualPanto Studio (2026-10-10 · Zoom im Level-Editor, …)“. Steht dort etwas anderes, liefert der Browser noch eine alte Kopie aus.

- **Emulator:** funktioniert in jedem aktuellen Browser. Me mit der Maus ziehen, It mit Shift + Ziehen oder der rechten Maustaste.
- **Echtes Gerät:** nur in Chrome oder Edge am Desktop (Web Serial API). Die Seite muss über `localhost` oder `https` laufen. Mit „Gerät verbinden“ wählst du den Port aus (CP210x / SLAB_USBtoUART). Der ESP32-Treiber wird weiterhin gebraucht.
- **Code-Editor:** Monaco (der Editor von VS Code) wird von jsDelivr geladen. Ohne Internet erscheint automatisch ein einfacher Texteditor. Für den Offline-Betrieb kann Monaco nach `vendor/monaco-editor/` gelegt werden (`npm pack monaco-editor@0.52.2` und entpacken). Diese Kopie wird dann bevorzugt.

## Auf GitHub Pages veröffentlichen

Die App besteht nur aus statischen Dateien und benutzt ausschließlich relative Pfade, sie läuft also unverändert unter `https://<name>.github.io/<repo>/`. Pages liefert über HTTPS aus – mehr braucht Web Serial nicht.

```bash
cd dualpanto-studio
git init -b main
git add .
git commit -m "DualPanto Studio"
git remote add origin git@github.com:<name>/<repo>.git
git push -u origin main
```

Danach im Repository unter **Settings → Pages** als Quelle **GitHub Actions** auswählen. Der mitgelieferte Workflow `.github/workflows/pages.yml` lädt den Ordner bei jedem Push auf `main` hoch; unter **Actions** steht anschließend die Adresse der Seite.

Hinweise:

- Pages setzt auf die Dateien ein Caching von etwa zehn Minuten. Direkt nach einem Deployment hilft ein harter Reload (Strg/⌘ + Umschalt + R).
- `.nojekyll` liegt im Repository, damit GitHub die Dateien unverändert ausliefert.
- Kommt später ein Build dazu (TypeScript, React), ändert sich nur der `path` im Workflow von `.` auf `dist`.
- Projekte der Nutzer liegen weiterhin im Browser bzw. in deren eigenen Ordnern – auf Pages wird nichts gespeichert.

## Was drin ist

- **Vorlagen:** Hallo Panto, Labyrinth (2 Level, Wände und Schiene), To-do-Liste (Produktivitäts-App mit `ui.menu` und `storage`), Fangen (It bewegt sich), Leeres Projekt.
- **Level-Editor:** Wände (als Linienzug oder geschlossene Form), Kisten, Schienen (Hallways), rechteckige und runde Zonen, Startpunkte für Me und It, Raster, Rückgängig/Wiederholen und eine Eigenschaften-Leiste mit Code-Schnipsel „Im Skript verwenden“.
- **Zoom im Level-Editor:** Mausrad oder Pinch zoomt zum Mauszeiger, Ziehen auf leerer Fläche (oder mit mittlerer Maustaste bzw. gedrückter Leertaste) verschiebt. Tasten: `+`, `−`, `0` für die ganze Fläche, `F` für die Auswahl. Oben gibt es dieselben Knöpfe und die Zoomstufe.
- **Mehrere Level:** Die Seitenleiste zeigt alle Level als Vorschaubild. `panto.loadLevel()` bzw. `panto.nextLevel()` wechseln das Level. Objekte, Zonen, Timer und Tasten-Handler, die ein Level anlegt, werden beim Wechsel automatisch aufgeräumt. `state` bleibt erhalten.
- **Skripte:** ein **Haupt-Skript** (Intro, Spielstand, Level-Steuerung, globale Tasten) und pro Level ein **Level-Skript** (Tab „Skript“ im Level). Im Level-Skript ist `level` vorhanden; alles, was es anlegt, wird beim Level-Wechsel aufgeräumt. Fehler in der Konsole verlinken auf die richtige Datei und Zeile.
- **Skript-API:** siehe Tab „API“ in der App. Im Editor gibt es dazu Autovervollständigung.
- **Sounds:** MP3/WAV in der Seitenleiste hochladen oder hineinziehen, im Skript mit `sound.play("name.wav")` abspielen (auch `loop`, `volume`, `rate`, `stop()`, `await …ended`).
- **Speicherung:** siehe unten.

## Projekt als Ordner (für die Arbeit zu zweit)

Ein Projekt kann statt im Browser-Speicher als **Ordner auf der Festplatte** liegen. Dann ist es git-fähig: unterschiedliche Level sind unterschiedliche Dateien, und ein Konflikt in einem Skript ist ein normaler Text-Konflikt.

```
mein-spiel/
├── projekt.json        Name, Einstellungen, Reihenfolge der Level
├── main.js             Haupt-Skript
├── levels/gang.json    Objekte, Startpunkte, Intro
├── levels/gang.js      Level-Skript
├── sounds/treffer.wav
└── README.md           wird einmal angelegt und erklärt den Aufbau
```

- **Verbinden:** „Projekte → Ordner öffnen“ (vorhandenes Projekt) oder „Projekt in Ordner speichern“ (aktuelles Projekt in einen leeren Ordner legen). Die Oberfläche zeigt oben den Ordnernamen und ob alles geschrieben ist.
- **Speichern** passiert automatisch kurz nach jeder Änderung, zusätzlich mit Strg/⌘ + S. Geschrieben wird nur, was sich wirklich geändert hat, damit git keine unnötigen Änderungen sieht.
- **Änderungen von außen** (git pull, der andere Rechner) erkennt das Studio alle paar Sekunden und lädt neu. Gibt es gleichzeitig ungespeicherte eigene Änderungen, kommt stattdessen eine Warnung, und „Vom Ordner neu laden“ holt den Stand bewusst.
- **Level umbenennen** benennt auch die Dateien um, gelöschte Level verschwinden aus dem Ordner.
- Nötig ist die File System Access API, also Chrome oder Edge am Computer – dieselbe Einschränkung wie bei Web Serial. In anderen Browsern bleibt der Browser-Speicher mit Export und Import.

**Typischer Ablauf zu zweit:** Ordner ist ein Git-Repo, beide öffnen ihn im Studio, jeder arbeitet an eigenen Leveln, committen und pullen wie gewohnt. Sounds sind Binärdateien – die sollten nicht gleichzeitig von beiden ausgetauscht werden.

## Wo die Daten liegen

- **Projekte** (Name, Haupt-Skript, Level mit Objekten und Level-Skripten, Einstellungen) stehen als JSON im **localStorage** des Browsers, unter dem Schlüssel `dualpanto-web:projects`. Das sind nur ein paar KB pro Projekt; localStorage fasst insgesamt rund 5 MB. Die Daten gehören zu Browser und Rechner: ein anderer Browser oder ein anderer Rechner sieht sie nicht, und „Websitedaten löschen“ entfernt sie.
- **Sounds** liegen als Blob in der **IndexedDB** `dualpanto-studio` (Store `assets`), weil Audiodateien für localStorage zu groß sind. Dort gibt es je nach Browser und freiem Speicherplatz hunderte MB. Im Projekt selbst stehen nur Name, Typ und Größe. Pro Datei sind 25 MB erlaubt; die Seitenleiste zeigt unten, wie viel Platz belegt ist.
- **Ordner-Projekte** liegen vollständig auf der Festplatte (siehe oben). Der Browser merkt sich nur, welcher Ordner zuletzt offen war, und fragt beim nächsten Öffnen einmal nach der Erlaubnis.
- **Sicherung und Austausch:** „Projekte → Aktuelles Projekt exportieren“ schreibt eine `.dualpanto.json` mit allem, Sounds als Base64 eingebettet. Import legt die Sounds wieder in der IndexedDB an. Das ist auch der Weg, ein Projekt an jemand anderen weiterzugeben oder in Git zu legen.
- Zum Teilen über einen Server wäre später eine echte Ablage nötig (Datei-Export in einen Ordner oder ein kleines Backend). Für den Prototyp reicht der Browser-Speicher.

## Aufbau

```
index.html, styles.css
src/main.js                 App: Projekt, Seitenleiste, Eigenschaften, Konsole, Start/Stopp
src/panto/protocol.js       DualPanto-Serial-Protokoll Rev. 6 (Pakete bauen und parsen)
src/panto/webserial.js      echtes Gerät über Web Serial (Handshake, Heartbeat, ACK/Resend)
src/panto/emulator.js       Software-Panto: God-Object-Kollision, Schienen, Tweening
src/panto/runtime.js        führt Projekte aus und stellt die Skript-API bereit
src/panto/geometry.js       2D-Helfer
src/editor/assets.js        Sound-Speicher (IndexedDB), Export/Import als Base64
src/editor/folder.js        Projekt als Ordner lesen/schreiben (File System Access API)
src/editor/*                Code-Editor, Level-Editor, Renderer, Vorlagen, API-Doku
```

Emulator und Gerät haben dieselbe Schnittstelle (`createObstacle`, `createRail`, `moveHandle`, `free` …). Die Runtime merkt also nicht, womit sie gerade spricht.

## Koordinaten

Die API rechnet in Millimetern. Der Ursprung liegt oben links, x zeigt nach rechts, y nach unten. Die Arbeitsfläche ist 360 × 210 mm (Profil „Ember“ aus `DualPantoSync.cs`). `webserial.js` rechnet in Gerätekoordinaten um: `x_dev = x − 180`, `y_dev = 5 − y`. Die Drehung wird wie in Unity negiert.

### Erreichbarer Bereich (Me ≠ It)

Die Griffe erreichen nur einen Teil der 360 × 210 mm, und Me und It reichen unterschiedlich weit. Die beiden Pantographen sind spiegelbildlich gebaut (`hardware/ember.json`): Me reicht weiter nach rechts, It weiter nach links, und nur in der Mitte überschneiden sich die Bereiche.

Die Umrisse stehen in `src/panto/areas.js`. Sie stammen aus `ember_area.svg` des Unity-Toolkits (`EmberWorkingArea` im Panto-Prefab: Plane, Skalierung 3,8, 180° gedreht). Welcher Umriss zu welchem Griff gehört, habe ich mit der Kinematik aus `ember.json` geprüft: Etwa 98 % jedes Umrisses sind für den zugeordneten Griff erreichbar, für den anderen Griff nur 63 %.

- Der **Emulator** lässt die Griffe nicht aus ihrem Bereich.
- `moveTo` auf unerreichbare Punkte fährt zum nächsten erreichbaren Punkt und warnt einmal in der Konsole.
- Der Rand des Me-Bereichs kann beim Start als Wand angelegt werden (Schalter „Rand“ oben, Projekteinstellung `boundary`). Standardmäßig **aus**: Der Umriss kostet ein Paket pro Punkt, und am Gerät sollen zuerst die Hindernisse des Levels ankommen. Steht Me beim Einschalten außerhalb, fährt der Griff zuerst hinein.
- Beim Laden eines Levels warnt die Konsole vor Zonen, Schienen und Startpunkten außerhalb. Wände dürfen über den Rand ragen.
- Skript-API: `me.canReach(p)`, `panto.canReach(p, "both")`, `panto.area("it")`, `randomPoint(margin, handle)`.

## Protokoll-Notizen

Quelle ist `dualpantoframework` (Stand Juli 2026): `documentation/protocol`, `utils/serial`, `firmware/src/utils/serial.cpp`.

- Alles ist Big-Endian, Floats sind 32 Bit. Der Header besteht aus `44 50 | Typ | Paket-ID | Länge (u16)`.
- Zustandsändernde Pakete (Obstacles, Rails, Enable/Disable/Remove) brauchen eine Paket-ID ≠ 0 und werden einzeln verschickt, bis ein ACK kommt. Nach einem Reconnect ohne Reset übernimmt die App die ID, die das Gerät erwartet (`INVALID_PACKET_ID`).
- Die Firmware ignoriert die Punkte in `CREATE_OBSTACLE` und liest aus jedem `ADD_TO_OBSTACLE` nur den ersten Punkt. Ein NaN-Punkt trennt Linienzüge.
- **`ADD_TO_OBSTACLE` mit genau einem Punkt schicken (11 Byte Payload).** Das Unity-Plugin schickt zwei Punkte (19 Byte). `receiveAddToObstacle` liest aber nur den ersten, die übrigen 8 Byte bleiben im Empfangspuffer. `receiveMagicNumber` überspringt sie danach und antwortet mit `INVALID_DATA`, also einmal pro Eckpunkt. Die Web-App schickt deshalb nur einen Punkt.
- **Jedes `SYNC_ACK` ruft in der Firmware `GodObject::reset()` auf und löscht alle Hindernisse.** Die Firmware schickt alle 10 ms ein SYNC, bis das ACK ankommt, also sind nach dem Verbinden meist noch welche unterwegs. Die App bestätigt deshalb nur das erste. Kommt später wieder ein SYNC, ist das Gerät neu gestartet, und die laufende App überträgt alle Hindernisse erneut.
- **Hindernis-IDs nie wiederverwenden.** `REMOVE_OBSTACLE` löscht in der Firmware erst später (Aktionswarteschlange, eine Aktion pro Physik-Frame). Hätte ein neuer Programmlauf („Neu starten“) wieder bei ID 1 angefangen, hätte ein noch wartendes Löschen das neue Hindernis entfernen können. Die IDs zählen deshalb pro Verbindung weiter.
- Nach dem Übertragen meldet die Konsole, was das Gerät bestätigt hat, z. B. „Hindernisse bestätigt: 2 angelegt, 2 aktiviert“.
- Motor-Speed (`0x92`) ist in der Firmware 1 / Dauer in Sekunden, keine Geschwindigkeit. `moveTo({speed})` rechnet mm/s entsprechend um.
- **Möglicher Bug im Unity-Plugin:** `CppLib::createPassableObstacle` (`utils/serial/src/cppLib/lib.cpp`) schreibt den Panto-Index nicht. Dadurch hat das Paket 18 statt 19 Byte und wird mit „INVALID PACKET“ verworfen. Durchlässige Hindernisse kommen damit wahrscheinlich nie am Gerät an. Die Web-App schickt den Index mit.

## Wenn am Gerät nichts zu spüren ist

1. „Geräte-Log“ in der Konsole einschalten. Jedes Hindernis-Paket und jede Bestätigung wird dann einzeln protokolliert (`→ CREATE_OBSTACLE id 3`, `ACK 3`).
2. Nach dem Übertragen muss die Zeile „Hindernisse bestätigt: … angelegt, … aktiviert“ kommen. Fehlt sie oder steht dort „Gerät bestätigt Paket nicht“, kommen die Pakete nicht an – dann ist es ein Verbindungs- und kein Level-Problem.
3. Mit **Selbsttest** (oben rechts) wird genau eine Wand quer durch die Mitte angelegt. Spürt man die nicht, liegt es nicht am Level.
4. Schalter „Rand“ aus lassen, solange etwas nicht läuft: der Umriss schickt rund 30 zusätzliche Pakete vor allem anderen.
5. Das Gerät quittiert jedes zustandsändernde Paket, bevor es es verarbeitet. Die App lässt deshalb 10 ms Pause zwischen zwei solchen Paketen, so wie es das Unity-Toolkit mit `ColliderRegistry` macht (dort 10 ms pro Collider).

## Getestet und nicht getestet

- Getestet in Chromium (headless): alle Vorlagen im Emulator, Kollision, Schienen, Level-Wechsel, `ui.menu`, Tastatur, Fehler mit Zeilennummer, Level-Editor mit Rückgängig.
- Getestet gegen eine **simulierte Firmware**: Handshake, Heartbeat-ACKs, Paket-IDs/ACKs, Obstacle- und Rail-Upload, Level-Wechsel, Aufräumen beim Stopp, Neustart des Geräts (erneutes Übertragen) und der Selbsttest.
- **Noch nicht an echter Hardware getestet.** Zuerst prüfen: Richtung von x/y und Drehung, Reset über DTR/RTS, Dauer der Transitions und wie sich Schienen anfühlen.

## Nächste Schritte (Ideen)

- Hardware-Test, danach Koordinaten und Speed feinjustieren; Profil-Auswahl (Ember / Version D) in der Oberfläche; Umrisse für weitere Geräte
- Heartbeat/Runtime-Tick in einen Web Worker verlegen, damit Hintergrund-Tabs nicht gedrosselt werden
- Export als eigenständige Webseite (App ohne Editor teilen)
- Sounds hochladen, Kräftefelder, Polygon-Zonen im Editor
- Mehr Vorlagen (Pong, Kartenleser, Diagramm abtasten)
