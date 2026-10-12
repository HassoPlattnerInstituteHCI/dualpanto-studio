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

Danach im Repository unter **Settings → Pages** als Quelle **Deploy from a branch** wählen, Branch `main`, Ordner `/ (root)`. Nach ein bis zwei Minuten steht die Seite unter `https://<name>.github.io/<repo>/`. Mehr ist für die jetzige Version nicht nötig, weil nichts gebaut werden muss.

Wer lieber über GitHub Actions deployen will (nötig, sobald ein Build dazukommt), legt `.github/workflows/pages.yml` an und stellt die Quelle auf **GitHub Actions** um:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .          # später "dist", wenn gebaut wird
      - id: deployment
        uses: actions/deploy-pages@v4
```

Hinweise:

- Pages setzt auf die Dateien ein Caching von etwa zehn Minuten. Direkt nach einem Deployment hilft ein harter Reload (Strg/⌘ + Umschalt + R).
- `.nojekyll` liegt im Repository, damit GitHub die Dateien unverändert ausliefert.
- Kommt später ein Build dazu (TypeScript, React), wird aus „Deploy from a branch“ der Workflow oben mit `path: dist`.
- Projekte der Nutzer liegen weiterhin im Browser bzw. in deren eigenen Ordnern – auf Pages wird nichts gespeichert.

## Was drin ist

- **Vorlagen:** Hallo Panto, Labyrinth (2 Level, Wände und Schiene), To-do-Liste (Produktivitäts-App mit `ui.menu` und `storage`), Fangen (It bewegt sich), Sammeln (Gegner und Items), Sprach-Notizen (Spracheingabe), Leeres Projekt.
- **Level-Editor:** Wände (als Linienzug oder geschlossene Form), Kisten, Schienen (Hallways), rechteckige und runde Zonen, **Gegner und Items**, Startpunkte für Me und It, Raster, Rückgängig/Wiederholen und eine Eigenschaften-Leiste mit Code-Schnipsel „Im Skript verwenden“.
- **Gegner, Items und eigene Objekte (Entities):** sichtbare Objekte in der Szene, die reagieren, wenn ein Griff in ihren Radius kommt. Sie hängen **nicht** am Gerät: gezeichnet werden sie im Editor und in der Vorschau, gespürt wird sie nur, wenn man es ausdrücklich will (`solid: true` legt eine runde Wand an, `attachTo("it")` schickt den It-Griff dauernd hin). Ohne eine Zeile Code verschwindet ein Item beim Berühren und piept, ein Gegner brummt; ein Text unter „Beim Berühren sagen“ wird gesprochen, ein gewählter Sound abgespielt.
- **Zoom im Level-Editor:** Mausrad oder Pinch zoomt zum Mauszeiger, Ziehen auf leerer Fläche (oder mit mittlerer Maustaste bzw. gedrückter Leertaste) verschiebt. Tasten: `+`, `−`, `0` für die ganze Fläche, `F` für die Auswahl. Oben gibt es dieselben Knöpfe und die Zoomstufe.
- **Ein Griff hängt an einem Objekt:** `it.switchTo(gegner)` fährt den It-Griff zum Objekt und lässt ihn daran hängen – bewegt sich das Objekt, fährt der Griff mit (0,8 mm Nachlauf, ruhig; Schrauben dafür: `ease`, `hz`, `smooth`, `lead`). Das ist das Gegenstück zu `PantoHandle.SwitchTo` im Unity-Toolkit und der Weg, einen Gegner fühlbar zu machen. Ziel kann ein Gegner/Item, eine Zone, der andere Griff, ein Punkt oder eine Funktion sein; `me.switchTo(...)` führt die Hand der Person mit. `it.stopFollow()`, `it.free()` beenden es.
- **Objekte zur Laufzeit:** Wände, Kisten, Kreise, Schienen, Zonen, Gegner und Items lassen sich jederzeit im Skript anlegen, ein- und ausschalten und entfernen – beim Start, in einem Timer, in `onFrame`, als Reaktion auf eine Zone, eine Taste oder einen Sprachbefehl. Wiederfinden über den Namen mit `level.object/zone/entity` bzw. `panto.find` (auch im Haupt-Skript). Was ein Level-Skript anlegt, verschwindet beim Level-Wechsel; was das Haupt-Skript anlegt, bleibt. Am Gerät kostet jedes Hindernis Pakete (CREATE + ein Paket pro Punkt + ENABLE, je 10 ms Abstand), deshalb für häufige Wechsel besser einmal anlegen und nur enable/disable benutzen; Zonen und Entities kosten nichts.
- **Mehrere Level:** Die Seitenleiste zeigt alle Level als Vorschaubild. `panto.loadLevel()` bzw. `panto.nextLevel()` wechseln das Level. Objekte, Zonen, Timer und Tasten-Handler, die ein Level anlegt, werden beim Wechsel automatisch aufgeräumt. `state` bleibt erhalten.
- **Skripte:** ein **Haupt-Skript** (Intro, Spielstand, Level-Steuerung, globale Tasten) und pro Level ein **Level-Skript** (Tab „Skript“ im Level). Im Level-Skript ist `level` vorhanden; alles, was es anlegt, wird beim Level-Wechsel aufgeräumt. Fehler in der Konsole verlinken auf die richtige Datei und Zeile.
- **Skript-API:** siehe Tab „API“ in der App. Im Editor gibt es dazu Autovervollständigung.
- **Level im Code:** `panto.defineLevel("Arena", (level) => { … })` macht ein Level bekannt, das im Editor gar nicht existiert – gut für zufällig erzeugte oder aus Daten gebaute Level. `panto.onFrame((dt) => …)` läuft in jedem Bild (ca. 60 Hz) für eigene Spiellogik, `panto.time` ist die Laufzeit in Sekunden. Objekte, die ein Level-Skript anlegt, findet `level.entity("…")`, `level.items()`, `level.zones()` genauso wie die gezeichneten.
- **Spracheingabe:** Sprachbefehle mit Mustern (`voice.command("setze punkte {n:zahl}", …)`), Fragen mit gesprochener Antwort (`voice.ask`, `voice.confirm`), Push-to-talk, deutsche Zahlwörter, Toleranz gegen Erkennungsfehler. Siehe unten.
- **Sounds:** MP3/WAV in der Seitenleiste hochladen oder hineinziehen, im Skript mit `sound.play("name.wav")` abspielen (auch `loop`, `volume`, `rate`, `stop()`, `await …ended`).
- **Speicherung:** siehe unten.

## Spracheingabe

Die Web Speech API gibt es in Chrome und Edge am Computer – dieselben Browser wie bei Web Serial, also kein zusätzlicher Verlust. Zwei Dinge muss man wissen:

- **Die Erkennung läuft in Chrome über einen Server.** Das Audio geht ins Netz, offline funktioniert sie nicht. Neuere Chrome-Versionen können auch **auf dem Gerät** erkennen: `voice.localAvailable()` prüft es, `voice.installLocal()` lädt das Sprachpaket (einmal Internet nötig), danach bleibt mit `voice.start({ local: true })` alles auf dem Rechner. Beim Start schreibt das Studio in die Konsole, was in diesem Browser gilt – für ein Nutzerstudium ohne WLAN ist das der entscheidende Punkt.
- **Das Programm spricht selbst.** Das Mikrofon hört `speak()` mit und würde die eigene Ausgabe als Eingabe erkennen. Ergebnisse, die während oder bis `voice.echoWindow` ms (Standard 1500) nach der eigenen Ausgabe kommen **und** ihr ähnlich sind, werden verworfen; im Geräte-Log steht dann „eigene Ausgabe verworfen“. Eine echte Antwort direkt nach der Frage kommt durch. Wer ganz sicher sein will, nimmt `voice.pushToTalk("v")`: Taste halten und sprechen.

Beim Start prüft das Studio **nicht** von selbst, ob Erkennung auf dem Gerät möglich ist: `SpeechRecognition.available()` ist experimentell und hat in einem Chromium ohne Spracherkennungs-Dienst (headless, im Test aufgefallen) den Renderer zum Absturz gebracht – weiße Seite, und das fängt kein `try/catch` auf. Die Prüfung läuft nur, wenn ein Skript `voice.localAvailable()` aufruft.

Interpretiert wird mit **Mustern**, nicht mit einem Sprachmodell (das bräuchte einen API-Key und damit ein Backend):

```js
voice.command("(start|starte|los) spiel", () => panto.loadLevel("Arena"));
voice.command("gehe zu {ziel}", ({ ziel }) => speak("Ich suche " + ziel));
voice.command("setze punkte {n:zahl}", ({ n }) => (state.punkte = n));  // "dreiundzwanzig" → 23
voice.command("*", ({ text }) => log("nicht verstanden: " + text));      // Auffangmuster

const text = await voice.ask("Wie heißt die Aufgabe?");
const n    = await voice.ask("Wie viele Punkte?", { expect: "zahl" });
const ja   = await voice.confirm("Wirklich löschen?");
```

Der letzte Platzhalter nimmt den Rest des Satzes. Füllwörter davor, Beugungen („startet“ statt „start“) und Umlaut-Schreibweisen („gruen“/„grün“) werden toleriert; `parseNumber`, `matchText` und `normalizeText` stehen auch einzeln zur Verfügung. Das Mikrofon-Feld oben rechts zeigt den Zustand und schaltet per Klick um, erkannte Sätze stehen in der Konsole und in der Vorschau.

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
src/panto/runtime.js        führt Projekte aus, Entities/Frame-Loop, Skript-API
src/panto/voice.js          Spracheingabe: Muster, Zahlwörter, Echo-Schutz, ask/confirm
src/panto/geometry.js       2D-Helfer
src/editor/assets.js        Sound-Speicher (IndexedDB), Export/Import als Base64
src/editor/folder.js        Projekt als Ordner lesen/schreiben (File System Access API)
src/editor/*                Code-Editor, Level-Editor, Renderer, Vorlagen, API-Doku
```

Emulator und Gerät haben dieselbe Schnittstelle (`createObstacle`, `createRail`, `moveHandle`, `free` …). Die Runtime merkt also nicht, womit sie gerade spricht.

## Ein Griff folgt einem Objekt

Im Unity-Toolkit macht das `PantoHandle.SwitchTo(gameObject)`: einmal hinfahren, danach schickt `FixedUpdate` die Zielposition in jedem Physik-Frame neu. Im Studio heißt es `switchTo` (Alias `follow`):

```js
const gegner = level.entity("Wächter");
gegner.patrol([[150, 80], [210, 140]], { speed: 60 });
await it.switchTo(gegner);        // fährt hin; das Promise erfüllt sich beim Ankommen
it.isFollowing; it.followName;    // true, "Wächter"
it.stopFollow();                  // stehen bleiben    it.free() = loslassen
```

Ziel darf sein: ein Gegner oder Item, eine Zone (ihr Mittelpunkt), der andere Griff, ein Punkt – oder eine Funktion, die einen Punkt liefert (`it.switchTo(() => ({ x: 200, y: 110 + panto.time }))`). Läuft das Ziel aus dem erreichbaren Bereich des Griffs, bleibt der Griff am nächsten erreichbaren Punkt und die Konsole warnt einmal. In der Vorschau zeigt eine gestrichelte Linie, an welchem Objekt ein Griff hängt.

### Damit der Griff ruhig läuft

Die Firmware fährt das God Object in `1 / SPEED` Sekunden zum Ziel. Daraus folgen zwei Dinge, die wir beide gemessen haben (Emulator, Ziel mit konstanten 60 mm/s, Kennzahlen aus den Positions-Events des Geräts):

- **Dauer nur einmal setzen** (so macht es das Toolkit) → der Griff kriecht nach: 50–70 mm Nachlauf bei einem 60 mm/s schnellen Ziel.
- **Dauer = ein Update-Intervall** → jede Fahrt ist vorbei, bevor das nächste Ziel kommt. Der Griff steht 26 % der Zeit und pulsiert mit der Update-Rate (gemessen 32–46 Beschleunigungswechsel/s). Am Gerät fühlt sich das wie Vibrieren an.

Deshalb dauert eine Fahrt standardmäßig **2,5 Intervalle** (`ease`), die Fahrten überlappen sich also und die Geschwindigkeit bleibt gleichmäßig. Den Nachlauf, den das kostet, gleicht ein **Vorhalt** aus (`lead`: es wird dorthin gezielt, wo das Ziel am Ende der Fahrt sein wird), und ein verrauschtes Ziel wird **geglättet** (`smooth`; die Zielgeschwindigkeit für den Vorhalt kommt aus dem geglätteten Verlauf, sonst speist das Rauschen sich wieder ein). Ergebnis mit den Standardwerten: **0,8 mm Nachlauf, 3 Beschleunigungswechsel/s, kein Stillstand** statt 1,3 mm / 32 / 26 %.

```js
it.switchTo(gegner, {
  speed: 150,     // Obergrenze mm/s – für die Anfahrt und für Sprünge des Ziels
  hz: 20,         // Aktualisierungen pro Sekunde
  ease: 2.5,      // Fahrtdauer in Intervallen: größer = ruhiger, träger
  smooth: 0.25,   // Glättung des Ziels (ist das Ziel ein Griff: 0.6)
  lead: 0.6,      // Vorhalt gegen den Nachlauf
  deadzone: 1,    // erst senden, wenn sich das Ziel 1 mm bewegt hat
});
```

Zuckt es am Gerät trotzdem: `ease` auf 3–4, `hz` auf 12–15. Hängt der Griff zu weit hinterher: `ease` kleiner (nicht unter 1.5) oder `lead` auf 1. Zappelt das Ziel (die Hand der Person): `smooth` auf 0.6–0.8. Gesendet werden mit den Standardwerten rund 17 Positions-Pakete pro Sekunde (Toolkit: 50), und nur solange sich das Ziel bewegt.

**Der Emulator tweente bisher jede Fahrt aus dem Stillstand** (`easeInOut` beginnt mit Geschwindigkeit 0). Bei einem laufend aktualisierten Ziel pulsierte er dadurch stärker als die echte Mechanik. Er nimmt die Anfangsgeschwindigkeit jetzt mit (Hermite-Interpolation: beginnt mit der vorhandenen Geschwindigkeit, endet in Ruhe) – ein einzelnes `moveTo` sieht aus wie vorher.

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

## Wenn die Seite lädt, aber nichts funktioniert

Oben erscheint dann ein rotes Feld mit der Fehlermeldung, der Datei und der Zeile (das macht ein kleines Inline-Skript in `index.html`, damit ein Startfehler nicht als weiße Seite endet). Die üblichen Ursachen:

1. **Syntaxfehler in einem Modul.** Bricht eine Datei beim Parsen ab, lädt `src/main.js` nicht mehr und die ganze Oberfläche bleibt tot. Die Meldung nennt Datei und Zeile. Achtung bei `api-docs.js`: dort steht die API-Referenz in Template-Literalen – ein einzelnes Backtick im Text (`` `level` ``) beendet den String und bricht die Datei. Im Fließtext deshalb „Anführungszeichen“ statt Backticks verwenden. `node --check datei.js` findet das **nicht** (es parst nicht als ES-Modul); `node -e "import('./datei.js')"` schon.
2. **Alte Dateien aus dem Browser-Cache.** `python3 -m http.server` schickt keine Cache-Header, Chrome behält Module dann gern. Deshalb liegt `serve.py` dabei: `python3 serve.py` liefert mit `Cache-Control: no-store` aus. Nach einer Änderung einmal mit Umschalt + Neu laden hart neu laden.
3. **Per Doppelklick geöffnet** (`file://…/index.html`). ES-Module werden dann vom Browser blockiert – es braucht einen Server.

## Wenn am Gerät nichts zu spüren ist

1. „Geräte-Log“ in der Konsole einschalten. Jedes Hindernis-Paket und jede Bestätigung wird dann einzeln protokolliert (`→ CREATE_OBSTACLE id 3`, `ACK 3`).
2. Nach dem Übertragen muss die Zeile „Hindernisse bestätigt: … angelegt, … aktiviert“ kommen. Fehlt sie oder steht dort „Gerät bestätigt Paket nicht“, kommen die Pakete nicht an – dann ist es ein Verbindungs- und kein Level-Problem.
3. Mit **Selbsttest** (oben rechts) wird genau eine Wand quer durch die Mitte angelegt. Spürt man die nicht, liegt es nicht am Level.
4. Schalter „Rand“ aus lassen, solange etwas nicht läuft: der Umriss schickt rund 30 zusätzliche Pakete vor allem anderen.
5. Das Gerät quittiert jedes zustandsändernde Paket, bevor es es verarbeitet. Die App lässt deshalb 10 ms Pause zwischen zwei solchen Paketen, so wie es das Unity-Toolkit mit `ColliderRegistry` macht (dort 10 ms pro Collider).

## Getestet und nicht getestet

- Getestet in Chromium (headless): alle Vorlagen im Emulator, Kollision, Schienen, Level-Wechsel, `ui.menu`, Tastatur, Fehler mit Zeilennummer, Level-Editor mit Rückgängig und Zoom, Ordner-Projekte, Sound-Upload, Gegner/Items (Setzen, Verschieben, Radius, Einsammeln, `patrol`, `follow`, `attachTo`, `onFrame`, `defineLevel`).
- Getestet: **Objekte zur Laufzeit** im Emulator und gegen die simulierte Firmware – Anlegen aus Haupt-Skript, Timer und Tastendruck, Kollision an einer neu erzeugten Wand, `disable`/`enable`/`remove`, Auslösen von Zone/Gegner/Item, Aufräumen beim Level-Wechsel, `persistent`, und am Gerät saubere Pakete (keine Müll-Bytes, alles beim Stopp entfernt).
- Getestet gegen eine **simulierte Spracherkennung**: Muster mit Platzhaltern, Zahlwörter, Alternativen, Auffangmuster, Fuzzy-Treffer, `ask`/`confirm`, Push-to-talk, Auto-Neustart, Echo-Schutz und die Fehlermeldung bei verweigertem Mikrofon.
- **Mit einem echten Mikrofon noch nicht getestet** (headless gibt es keins): zu prüfen sind Erkennungsqualität auf Deutsch, die Latenz der Server-Erkennung und ob der Echo-Schutz bei echten Lautsprechern lang genug greift.
- Getestet gegen eine **simulierte Firmware**: Handshake, Heartbeat-ACKs, Paket-IDs/ACKs, Obstacle- und Rail-Upload, Level-Wechsel, Aufräumen beim Stopp, Neustart des Geräts (erneutes Übertragen) und der Selbsttest.
- **Noch nicht an echter Hardware getestet.** Zuerst prüfen: Richtung von x/y und Drehung, Reset über DTR/RTS, Dauer der Transitions und wie sich Schienen anfühlen.

## Nächste Schritte (Ideen)

- Hardware-Test, danach Koordinaten und Speed feinjustieren; Profil-Auswahl (Ember / Version D) in der Oberfläche; Umrisse für weitere Geräte
- Heartbeat/Runtime-Tick in einen Web Worker verlegen, damit Hintergrund-Tabs nicht gedrosselt werden
- Export als eigenständige Webseite (App ohne Editor teilen)
- Kräftefelder, Polygon-Zonen im Editor, Sprites/Icons für Entities
- Mehr Vorlagen (Pong, Kartenleser, Diagramm abtasten)
