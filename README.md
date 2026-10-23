# DualPanto Studio (prototype v0.1)

An online editor for DualPanto apps and games: draw levels, write JavaScript, test in the emulator or directly on the device. No Unity required.

## Getting started

The app consists of static files only and has no build step. Because it uses ES modules it has to be served by a small web server; `file://` does not work:

```bash
cd dualpanto-studio
python3 serve.py          # opens http://localhost:8000 in the browser
```

`serve.py` disables caching so the new version is always loaded after a change. `python3 -m http.server`, `npx serve` or "Live Server" in VS Code work too – if you get stale files there, do a hard reload (Ctrl/⌘ + Shift + R).

On start, the console (bottom right, "Console" tab) prints the software version, for example "Welcome to DualPanto Studio (2026-10-22 · new layout)". If it says something else, the browser is still serving an old copy.

- **Emulator:** works in any current browser. Drag Me with the mouse, It with Shift + drag or the right mouse button.
- **Real device:** only in Chrome or Edge on desktop (Web Serial API). The page must be served from `localhost` or `https`. "Connect device" lets you pick the port (CP210x / SLAB_USBtoUART). The ESP32 driver is still required.
- **Code editor:** Monaco (the VS Code editor) is loaded from jsDelivr. Without internet a simple text editor appears automatically. For offline use, put Monaco into `vendor/monaco-editor/` (`npm pack monaco-editor@0.52.2` and unpack); that copy is then preferred.

## Publishing on GitHub Pages

The app consists of static files only and uses relative paths exclusively, so it runs unchanged under `https://<name>.github.io/<repo>/`. Pages serves over HTTPS – that is all Web Serial needs.

```bash
cd dualpanto-studio
git init -b main
git add .
git commit -m "DualPanto Studio"
git remote add origin git@github.com:<name>/<repo>.git
git push -u origin main
```

Then, in the repository under **Settings → Pages**, choose **Deploy from a branch** as the source, branch `main`, folder `/ (root)`. After a minute or two the site is available at `https://<name>.github.io/<repo>/`. Nothing more is needed for the current version, since nothing has to be built.

If you prefer to deploy via GitHub Actions (needed once a build step is added), create `.github/workflows/pages.yml` and switch the source to **GitHub Actions**:

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
          path: .          # later "dist", once there is a build
      - id: deployment
        uses: actions/deploy-pages@v4
```

Notes:

- Pages caches the files for about ten minutes. Right after a deployment, a hard reload helps (Ctrl/⌘ + Shift + R).
- `.nojekyll` is in the repository so GitHub serves the files unchanged.
- If a build is added later (TypeScript, React), "Deploy from a branch" becomes the workflow above with `path: dist`.
- Users' projects still live in their browser or in their own folders – nothing is stored on Pages.

## Layout

- **Top bar:** project switcher (the name with ▾: rename, new project, all projects – later it will list all projects directly), save state, New and Projects. On the right: Reset, Boundary, Connect device, Self-test, the device status and ▶ Run.
- **Left:** the program's main script, the levels as a slide overview (thumbnails, numbered) and, below them, the properties of the selected level or object.
- **Center:** the level canvas with the tools, Clear, zoom, grid and undo/redo. "Square", "Rhombus" and "Full area" choose the level's work area (see below).
- **Right:** the code editor on top ("Main" or the selected level's script), below it the tabs Sounds, Console and API.
- The three columns and the two vertical splits are **resizable**: drag the dividers. The sizes are remembered in the browser.
- **▶ Run** opens the running app **fullscreen**: the live view with the handles, a slim bar (Restart, Stop, device and microphone state) and a collapsible console that opens by itself on errors. **Esc** or Stop goes back to the editor. Esc is reserved for that – scripts don't receive it while the app runs.

### Work area: Square, Rhombus, Full area

Everything in a level has to be reachable with both handles. "Full area" shows the two curved reachable areas of Me and It, as before. Most levels only need a simple shape, so "Square" and "Rhombus" use the **largest square** and the **largest rhombus** that lie inside the region both handles reach (both axis-aligned, stored in `EDITOR_VIEWS` in `src/panto/areas.js`): for the Ember 83 × 83 mm and 152 × 143 mm (diagonals). The shape is then **fixed in place**: it fills the canvas, zoom and panning are off, and nothing outside it is drawn – neither the curved areas nor objects that stick out (switching shows a warning when objects get cut off). New points, objects and start positions land inside the shape; moves and resizes that would push an object out are not applied, and boxes or zones dragged past the edge shrink to fit. The run view shows the shape the same way. On the device the handles are not held inside it. New levels start as "Square"; the choice is saved per level (`view` in the level, only written to folder projects when it is not "full").

### Speech output (TTS)

`speak()` and the "Say on …" texts use the browser's built-in voices (Web Speech API). Under Sounds → **TTS** the project picks a voice, rate and pitch, with a preview; the choice is saved in the project (`settings.tts`). `speak("…", { voice: "Name", rate: 1.4 })` changes them for one sentence (rate and pitch relative to the project setting). The voices come from the computer, so they differ between Windows, macOS and Linux; a project voice that does not exist on a computer falls back to the first voice of the project language, and the console says so. Chromium on Linux only has voices through speech-dispatcher (`sudo apt install speech-dispatcher espeak-ng`, start Chromium with `--enable-speech-dispatcher`); without any voice, `speak()` shows only the caption and the console warns once.

### Sounds tab

"Library" searches Freesound and imports previews into the project (see "Freesound search token" below). "Upload" lists the project's sounds (drag files onto the tab or press "Add Sounds"). "TTS" holds the speech settings (see above); "Record" is a placeholder for now.

## What's included

- **Templates:** Hello Panto, Maze (2 levels, walls and rail), To-do list (productivity app with `ui.menu` and `storage`), Tag (It moves), Collect (enemies and items), Pong (It is attached to the opponent, which follows the ball), Voice notes (voice input), Empty project.
- **Level editor:** walls (as a polyline or closed shape), boxes, rails (hallways), rectangular and round zones, **enemies and items**, start positions for Me and It, grid, undo/redo, Clear (removes all objects, undo brings them back), work area Square/Rhombus/Full area and a properties panel with a "use in script" code snippet.
- **Enemies, items and custom objects (entities):** visible objects in the scene that react when a handle comes within their radius. They are **not** attached to the device: they are drawn in the editor and the run view, and only felt if you explicitly want that (`solid: true` creates a round wall, `attachTo("it")` keeps sending the It handle there). Without a single line of code an item disappears and beeps when touched and an enemy buzzes; a text under "Say on touch" is spoken, a selected sound is played.
- **Work area and zoom in the level editor:** keys `1` Square, `2` Rhombus, `0` Full area. Square and Rhombus are fixed in place (see "Work area" above). In Full area, the mouse wheel or pinch zooms towards the pointer and dragging empty space (or with the middle mouse button or Space held) pans; keys `+`, `−`, `F` for the selection.
- **Attaching a handle to an object:** `it.switchTo(enemy)` moves the It handle to the object and keeps it attached – when the object moves, the handle moves along (0.8 mm lag, smooth; tuning knobs: `ease`, `hz`, `smooth`, `lead`). This is the counterpart to `PantoHandle.SwitchTo` in the Unity toolkit and the way to make an enemy tangible. The target can be an enemy/item, a zone, the other handle, a point or a function; `me.switchTo(...)` guides the person's hand. `it.stopFollow()` and `it.free()` end it.
- **Objects at runtime:** walls, boxes, circles, rails, zones, enemies and items can be created, enabled, disabled and removed in the script at any time – on start, in a timer, in `onFrame`, in response to a zone, a key or a voice command. Find them again by name with `level.object/zone/entity` or `panto.find` (also in the main script). What a level script creates disappears when the level changes; what the main script creates stays. On the device every obstacle costs packets (CREATE + one packet per point + ENABLE, 10 ms apart each), so for frequent changes it is better to create once and only use enable/disable; zones and entities cost nothing.
- **Multiple levels:** the sidebar shows all levels as a slide overview. `panto.loadLevel()` and `panto.nextLevel()` switch levels. Objects, zones, timers and key handlers a level creates are cleaned up automatically on the switch. `state` is kept.
- **Scripts:** one **main script** (intro, score, level control, global keys) and one **level script** per level (select the level, then "Level" in the code editor's header). In the level script, `level` is defined; everything it creates is cleaned up when the level changes. Errors in the console link to the right file and line.
- **Script API:** see the "API" tab in the app. The editor offers autocompletion for it.
- **Levels in code:** `panto.defineLevel("Arena", (level) => { … })` registers a level that does not exist in the editor at all – good for randomly generated or data-driven levels. `panto.onFrame((dt) => …)` runs every frame (about 60 Hz) for your own game logic, `panto.time` is the running time in seconds. Objects created by a level script are found by `level.entity("…")`, `level.items()`, `level.zones()` just like drawn ones.
- **Voice input:** voice commands with patterns (`voice.command("set score {n:number}", …)`), questions with spoken answers (`voice.ask`, `voice.confirm`), push-to-talk, English and German number words, tolerance against recognition errors. See below.
- **Sounds:** upload MP3/WAV in the Sounds tab ("Add Sounds") or drag them onto it, or search, preview and import Freesound previews under "Library". Search includes all licenses; check each sound's license and attribution before use. Imported audio is available in the script with `sound.play("name.wav")` (also `loop`, `volume`, `rate`, `stop()`, `await …ended`).

### Freesound search token

To use one Freesound API token across this static site, set `FREESOUND_API_TOKEN` in `src/editor/freesound-config.js` before deploying. **This publishes the token in the site's JavaScript.** Visitors can inspect and reuse it, so use this only if you accept that exposure and can replace the token if it is abused. A backend proxy is the safer option for a public site.
- **Storage:** see below.

## Language

The interface, templates and API reference are in English. New projects use `en-US` for speech output and voice recognition (project setting `lang`). Projects created earlier keep their stored language (`de-DE`), so existing German projects continue to speak and listen in German. Voice patterns understand both English and German number words, and `{n:zahl}` / `expect: "zahl"` keep working as aliases for `number`.

## Voice input

The Web Speech API is available in Chrome and Edge on desktop – the same browsers as Web Serial, so nothing extra is lost. Two things you need to know:

- **In Chrome, recognition runs on a server.** The audio goes over the network and it does not work offline. Newer Chrome versions can also recognise **on the device**: `voice.localAvailable()` checks this, `voice.installLocal()` downloads the language pack (needs internet once), and after that `voice.start({ local: true })` keeps everything on the computer. On start, the Studio writes to the console what applies in this browser – for a user study without Wi-Fi this is the crucial point.
- **The program speaks itself.** The microphone hears `speak()` and would recognise the program's own output as input. Results that arrive during or up to `voice.echoWindow` ms (default 1500) after the program's own output **and** resemble it are dropped; the device log then says "dropped own output". A real answer right after the question gets through. If you want to be completely sure, use `voice.pushToTalk("v")`: hold the key and speak.

On start, the Studio does **not** check by itself whether on-device recognition is possible: `SpeechRecognition.available()` is experimental and crashed the renderer in a Chromium without a speech recognition service (headless, noticed during testing) – white page, and no `try/catch` catches that. The check only runs when a script calls `voice.localAvailable()`.

Interpretation uses **patterns**, not a language model (that would need an API key and therefore a backend):

```js
voice.command("(start|begin|go) game", () => panto.loadLevel("Arena"));
voice.command("go to {target}", ({ target }) => speak("Looking for " + target));
voice.command("set score {n:number}", ({ n }) => (state.score = n));  // "twenty-three" → 23
voice.command("*", ({ text }) => log("not understood: " + text));     // catch-all

const text = await voice.ask("What is the task called?");
const n    = await voice.ask("How many points?", { expect: "number" });
const yes  = await voice.confirm("Really delete?");
```

The last placeholder takes the rest of the sentence. Filler words before it, word endings ("starting" instead of "start") and umlaut spellings ("gruen"/"grün") are tolerated; `parseNumber`, `matchText` and `normalizeText` are also available on their own. The microphone pill in the run view's bar shows the state and toggles on click; recognised sentences appear in the console and the run view.

## Project as a folder (for working in pairs)

Instead of browser storage, a project can live as a **folder on disk**. Then it works with git: different levels are different files, and a conflict in a script is an ordinary text conflict.

```
my-game/
├── project.json        name, settings, order of the levels
├── main.js             main script
├── levels/hallway.json objects, start positions, intro
├── levels/hallway.js   level script
├── sounds/hit.wav
└── README.md           created once, explains the layout
```

Folders created by older versions have a `projekt.json` instead; it is still read and renamed to `project.json` on the next save.

- **Connect:** "Projects → Open folder" (existing project) or "Save project to folder" (put the current project into an empty folder). The top bar shows the folder name and whether everything has been written.
- **Saving** happens automatically shortly after every change, and also with Ctrl/⌘ + S. Only files that actually changed are written, so git sees no unnecessary changes.
- **Changes from outside** (git pull, the other computer) are detected every few seconds and reloaded. If there are unsaved local changes at the same time, a warning appears instead, and "Reload from folder" fetches the state deliberately.
- **Renaming a level** renames its files too; deleted levels disappear from the folder.
- This needs the File System Access API, i.e. Chrome or Edge on desktop – the same restriction as Web Serial. In other browsers, browser storage with export and import remains.

**Typical workflow in pairs:** the folder is a git repo, both open it in the Studio, each works on their own levels, commit and pull as usual. Sounds are binary files – they should not be replaced by both people at the same time.

## Where the data lives

- **Projects** (name, main script, levels with objects and level scripts, settings) are stored as JSON in the browser's **localStorage** under the key `dualpanto-web:projects`. That is only a few KB per project; localStorage holds about 5 MB in total. The data belongs to the browser and computer: another browser or computer does not see it, and "clear site data" removes it.
- **Sounds** are stored as blobs in the **IndexedDB** `dualpanto-studio` (store `assets`), because audio files are too large for localStorage. Depending on browser and free disk space there are hundreds of MB available. The project itself only stores name, type and size. Each file may be up to 25 MB; the bottom of the sidebar shows how much space is used.
- **Folder projects** live entirely on disk (see above). The browser only remembers which folder was last open and asks once for permission the next time.
- **Backup and sharing:** "Projects → Export current project" writes a `.dualpanto.json` with everything, sounds embedded as Base64. Import puts the sounds back into IndexedDB. This is also the way to pass a project on to someone else or put it into git.
- Sharing via a server would later need real storage (file export into a folder or a small backend). For the prototype, browser storage is enough.

## Structure

```
index.html, styles.css
src/main.js                 app: project, sidebar, properties, console, run/stop, run view
src/panto/protocol.js       DualPanto serial protocol rev. 6 (build and parse packets)
src/panto/webserial.js      real device via Web Serial (handshake, heartbeat, ACK/resend)
src/panto/emulator.js       software panto: god object collision, rails, tweening
src/panto/runtime.js        runs projects, entities/frame loop, script API
src/panto/voice.js          voice input: patterns, number words, echo protection, ask/confirm
src/panto/geometry.js       2D helpers
src/editor/assets.js        sound storage (IndexedDB), export/import as Base64
src/editor/folder.js        read/write a project as a folder (File System Access API)
src/editor/*                code editor, level editor, renderer, templates, API docs
```

Emulator and device share the same interface (`createObstacle`, `createRail`, `moveHandle`, `free` …), so the runtime does not notice which one it is talking to.

## A handle follows an object

In the Unity toolkit this is `PantoHandle.SwitchTo(gameObject)`: move there once, after that `FixedUpdate` re-sends the target position every physics frame. In the Studio it is called `switchTo` (alias `follow`):

```js
const enemy = level.entity("Guard");
enemy.patrol([[150, 80], [210, 140]], { speed: 60 });
await it.switchTo(enemy);         // moves there; the promise resolves on arrival
it.isFollowing; it.followName;    // true, "Guard"
it.stopFollow();                  // stay put    it.free() = let go
```

The target may be an enemy or item, a zone (its centre), the other handle, a point – or a function that returns a point (`it.switchTo(() => ({ x: 200, y: 110 + panto.time }))`). If the target leaves the handle's reachable area, the handle stays at the nearest reachable point and the console warns once. In the run view a dashed line shows which object a handle is attached to.

### Keeping the handle smooth

The firmware moves the god object to the target in `1 / SPEED` seconds. Two consequences follow, both of which we measured (emulator, target at a constant 60 mm/s, metrics from the device's position events):

- **Setting the duration only once** (as the toolkit does) → the handle crawls behind: 50–70 mm lag with a target moving at 60 mm/s.
- **Duration = one update interval** → every move is over before the next target arrives. The handle stands still 26 % of the time and pulses at the update rate (measured 32–46 acceleration changes/s). On the device this feels like vibration.

So by default a move lasts **2.5 intervals** (`ease`); the moves overlap and the speed stays even. The lag this causes is compensated by a **lead** (`lead`: aim where the target will be at the end of the move), and a noisy target is **smoothed** (`smooth`; the target velocity for the lead comes from the smoothed history, otherwise the noise feeds back in). Result with the defaults: **0.8 mm lag, 3 acceleration changes/s, no standstill** instead of 1.3 mm / 32 / 26 %.

```js
it.switchTo(enemy, {
  speed: 150,     // upper limit mm/s – for the approach and for jumps of the target
  hz: 20,         // updates per second
  ease: 2.5,      // move duration in intervals: larger = calmer, more sluggish
  smooth: 0.25,   // smoothing of the target (if the target is a handle: 0.6)
  lead: 0.6,      // lead against the lag
  deadzone: 1,    // only send once the target has moved 1 mm
});
```

If it still twitches on the device: `ease` to 3–4, `hz` to 12–15. If the handle lags too far behind: lower `ease` (not below 1.5) or set `lead` to 1. If the target jitters (the person's hand): `smooth` to 0.6–0.8. With the defaults, about 17 position packets per second are sent (toolkit: 50), and only while the target moves.

**The emulator used to tween every move from standstill** (`easeInOut` starts at velocity 0). With a continuously updated target it therefore pulsed more than the real mechanics. It now carries over the initial velocity (Hermite interpolation: starts with the current velocity, ends at rest) – a single `moveTo` looks the same as before.

## Coordinates

The API works in millimetres. The origin is at the top left, x points right, y points down. The working area is 360 × 210 mm ("Ember" profile from `DualPantoSync.cs`). `webserial.js` converts to device coordinates: `x_dev = x − 180`, `y_dev = 5 − y`. Rotation is negated as in Unity.

### Reachable area (Me ≠ It)

The handles only reach part of the 360 × 210 mm, and Me and It reach differently far. The two pantographs are built as mirror images (`hardware/ember.json`): Me reaches further right, It further left, and the areas only overlap in the middle.

The outlines are in `src/panto/areas.js`. They come from `ember_area.svg` in the Unity toolkit (`EmberWorkingArea` in the Panto prefab: plane, scale 3.8, rotated 180°). Which outline belongs to which handle was checked against the kinematics in `ember.json`: about 98 % of each outline is reachable by its assigned handle, but only 63 % by the other handle.

- The **emulator** does not let the handles leave their area.
- `moveTo` to unreachable points moves to the nearest reachable point and warns once in the console.
- The edge of the Me area can be created as a wall on start ("Boundary" switch at the top, project setting `boundary`). **Off** by default: the outline costs one packet per point, and on the device the level's obstacles should arrive first. If Me is outside when it is switched on, the handle moves inside first.
- When a level loads, the console warns about zones, rails and start positions outside. Walls may stick out over the edge.
- Script API: `me.canReach(p)`, `panto.canReach(p, "both")`, `panto.area("it")`, `randomPoint(margin, handle)`.

## Protocol notes

Source is `dualpantoframework` (as of July 2026): `documentation/protocol`, `utils/serial`, `firmware/src/utils/serial.cpp`.

- Everything is big-endian, floats are 32 bit. The header is `44 50 | type | packet ID | length (u16)`.
- State-changing packets (obstacles, rails, enable/disable/remove) need a packet ID ≠ 0 and are sent one at a time until an ACK arrives. After a reconnect without reset, the app adopts the ID the device expects (`INVALID_PACKET_ID`).
- The firmware ignores the points in `CREATE_OBSTACLE` and only reads the first point of each `ADD_TO_OBSTACLE`. A NaN point separates polylines.
- **Send `ADD_TO_OBSTACLE` with exactly one point (11 byte payload).** The Unity plugin sends two points (19 bytes). But `receiveAddToObstacle` only reads the first; the remaining 8 bytes stay in the receive buffer. `receiveMagicNumber` then skips them and answers with `INVALID_DATA`, once per corner point. The web app therefore sends only one point.
- **Every `SYNC_ACK` calls `GodObject::reset()` in the firmware and deletes all obstacles.** The firmware sends a SYNC every 10 ms until the ACK arrives, so after connecting a few are usually still in flight. The app therefore only acknowledges the first one. If another SYNC arrives later, the device has restarted, and the running app sends all obstacles again.
- **Never reuse obstacle IDs.** `REMOVE_OBSTACLE` deletes later in the firmware (action queue, one action per physics frame). If a new program run ("Restart") started at ID 1 again, a still-pending delete could remove the new obstacle. IDs therefore keep counting per connection.
- After sending, the console reports what the device acknowledged, e.g. "Obstacles acknowledged: 2 created, 2 enabled".
- Motor speed (`0x92`) in the firmware is 1 / duration in seconds, not a speed. `moveTo({speed})` converts mm/s accordingly.
- **Possible bug in the Unity plugin:** `CppLib::createPassableObstacle` (`utils/serial/src/cppLib/lib.cpp`) does not write the panto index. The packet therefore has 18 instead of 19 bytes and is dropped with "INVALID PACKET". Passable obstacles probably never reach the device. The web app sends the index.

## If the page loads but nothing works

A red box with the error message, file and line appears at the top (done by a small inline script in `index.html`, so a startup error does not end up as a white page). The usual causes:

1. **Syntax error in a module.** If a file fails to parse, `src/main.js` no longer loads and the whole interface stays dead. The message names the file and line. Watch out in `api-docs.js`: the API reference is in template literals there – a single backtick in the text (`` `level` ``) ends the string and breaks the file. Use "quotation marks" instead of backticks in prose. `node --check file.js` does **not** find this (it doesn't parse as an ES module); `node -e "import('./file.js')"` does.
2. **Old files from the browser cache.** `python3 -m http.server` sends no cache headers, and Chrome likes to keep modules then. That is why `serve.py` is included: `python3 serve.py` serves with `Cache-Control: no-store`. After a change, do one hard reload with Shift + Reload.
3. **Opened by double-click** (`file://…/index.html`). The browser then blocks ES modules – a server is needed.

## If nothing can be felt on the device

1. Turn on "Device log" in the console. Every obstacle packet and every acknowledgement is then logged individually (`→ CREATE_OBSTACLE id 3`, `ACK 3`).
2. After sending, the line "Obstacles acknowledged: … created, … enabled" must appear. If it is missing or says "Device does not acknowledge the packet", the packets are not arriving – that is a connection problem, not a level problem.
3. **Self-test** (top right) creates exactly one wall across the middle. If you cannot feel that, the level is not the problem.
4. Leave the "Boundary" switch off while something isn't working: the outline sends about 30 extra packets before anything else.
5. The device acknowledges every state-changing packet before processing it. The app therefore pauses 10 ms between two such packets, as the Unity toolkit does with `ColliderRegistry` (10 ms per collider there).

## Tested and not tested

- Tested in Chromium (headless): all templates in the emulator, collision, rails, level changes, `ui.menu`, keyboard, errors with line numbers, level editor with undo and zoom, folder projects, sound upload, enemies/items (placing, moving, radius, collecting, `patrol`, `follow`, `attachTo`, `onFrame`, `defineLevel`).
- Tested: **objects at runtime** in the emulator and against the simulated firmware – creation from the main script, timers and key presses, collision with a newly created wall, `disable`/`enable`/`remove`, triggering zones/enemies/items, cleanup on level change, `persistent`, and clean packets on the device (no garbage bytes, everything removed on stop).
- Tested against a **simulated speech recogniser**: patterns with placeholders, number words, alternatives, catch-all patterns, fuzzy matches, `ask`/`confirm`, push-to-talk, auto-restart, echo protection and the error message when the microphone is denied.
- **Not yet tested with a real microphone** (headless has none): to check are recognition quality in English and German, the latency of server recognition and whether the echo protection lasts long enough with real speakers.
- Tested against a **simulated firmware**: handshake, heartbeat ACKs, packet IDs/ACKs, obstacle and rail upload, level changes, cleanup on stop, device restart (re-sending) and the self-test.
- **Not yet tested on real hardware.** Check first: direction of x/y and rotation, reset via DTR/RTS, duration of transitions and how rails feel.

## Next steps (ideas)

- Hardware test, then fine-tune coordinates and speed; profile selection (Ember / Version D) in the UI; outlines for further devices
- Move the heartbeat/runtime tick into a web worker so background tabs are not throttled
- Export as a standalone web page (share an app without the editor)
- Force fields, polygon zones in the editor, sprites/icons for entities
- More templates (card reader, exploring diagrams)
