// API reference: TypeScript declarations for autocompletion in the code editor
// and the human-readable reference shown in the "API" tab.

export const API_DTS = `
type Point = { x: number; y: number } | [number, number];
type Handles = 'both' | 'me' | 'it';

interface PantoHandle {
  /** Position, die die Person fühlt (God Object), in mm. */
  readonly position: { x: number; y: number };
  /** Echte Griffposition (kann in einer Wand stecken). */
  readonly handlePosition: { x: number; y: number };
  readonly x: number;
  readonly y: number;
  /** Drehung des Griffs in Grad. */
  readonly rotation: number;
  /** true, solange das Programm den Griff bewegt. */
  readonly isMoving: boolean;
  distanceTo(p: Point | PantoHandle): number;
  /** true, wenn der Griff den Punkt physisch erreichen kann. */
  canReach(p: Point | PantoHandle): boolean;
  /** Umriss des Bereichs, den dieser Griff erreichen kann (mm). */
  readonly area: { x: number; y: number }[] | null;
  /** Wird bei jeder Bewegung des Griffs aufgerufen. */
  onMove(fn: (pos: { x: number; y: number }) => void): () => void;
  /** Bewegt den Griff (speed in mm/s). Me wird danach freigegeben, It bleibt stehen (hold). */
  moveTo(p: Point | PantoHandle, options?: { speed?: number; duration?: number; rotation?: number; hold?: boolean }): Promise<boolean>;
  /** Gibt der Person die Kontrolle zurück. */
  free(): void;
  /** Hält den Griff an seiner Position fest. */
  freeze(): void;
  /** Drückt den Griff in eine Richtung, Stärke 0..1. */
  applyForce(dir: Point, strength?: number): void;
  stopForce(): void;
}

interface PantoObstacle {
  readonly id: number; readonly name: string; readonly type: 'wall' | 'rail'; readonly enabled: boolean;
  enable(): this; disable(): this; remove(): void;
}

interface PantoZone {
  readonly name: string; readonly enabled: boolean; readonly center: { x: number; y: number };
  /** Wird aufgerufen, wenn ein Griff die Zone betritt. */
  onEnter(fn: (handle: PantoHandle) => void): () => void;
  /** Wird aufgerufen, wenn ein Griff die Zone verlässt. */
  onExit(fn: (handle: PantoHandle) => void): () => void;
  contains(p: Point | PantoHandle): boolean;
  isInside(handle?: 'me' | 'it'): boolean;
  enable(): this; disable(): this; remove(): void;
}

interface PantoLevel {
  readonly name: string;
  readonly objects: Array<PantoObstacle | PantoZone>;
  /** Zone dieses Levels über ihren Namen aus dem Level-Editor. */
  zone(name: string): PantoZone;
  /** Beliebiges Objekt dieses Levels über seinen Namen. */
  object(name: string): PantoObstacle | PantoZone | null;
  zones(): PantoZone[];
}

interface ObjectOptions { name?: string; handles?: Handles; enabled?: boolean; /** bleibt bei Level-Wechseln erhalten */ persistent?: boolean }

declare const panto: {
  readonly me: PantoHandle;
  readonly it: PantoHandle;
  /** Das aktuell geladene Level. */
  readonly level: PantoLevel | null;
  /** Namen aller Level des Projekts. */
  readonly levels: string[];
  /** Größe der Arbeitsfläche in mm. */
  readonly width: number;
  readonly height: number;
  readonly device: 'emulator' | 'serial';
  /** Erreichbarer Bereich eines Griffs. Me und It haben verschiedene Bereiche. */
  area(handle?: 'me' | 'it'): { points: { x: number; y: number }[] | null; contains(p: Point | PantoHandle): boolean };
  /** Kann der Griff (oder beide) den Punkt erreichen? */
  canReach(p: Point | PantoHandle, handle?: 'me' | 'it' | 'both'): boolean;
  /** Wand entlang der Punkte. closed: true verbindet den letzten mit dem ersten Punkt. */
  wall(points: Point[], options?: ObjectOptions & { closed?: boolean; passable?: boolean }): PantoObstacle;
  /** Rechteckige Wand. */
  box(x: number, y: number, w: number, h: number, options?: ObjectOptions & { passable?: boolean }): PantoObstacle;
  /** Runde Wand. */
  circle(x: number, y: number, r: number, options?: ObjectOptions & { passable?: boolean; corners?: number }): PantoObstacle;
  /** Haptische Schiene („Hallway“). strength = Fangbreite in mm. */
  rail(points: Point[], options?: ObjectOptions & { strength?: number }): PantoObstacle;
  /** Unsichtbarer Bereich, der reagiert, wenn ein Griff ihn betritt. */
  zone(shape: { x: number; y: number; w: number; h: number } | { x: number; y: number; r: number } | Point[],
       options?: { name?: string; speak?: string; handle?: 'me' | 'it' | 'both'; persistent?: boolean }): PantoZone;
  loadLevel(name: string): Promise<PantoLevel | null>;
  nextLevel(): Promise<PantoLevel | null>;
  /** Führt fn jedes Mal aus, wenn das Level geladen wird. */
  onLevel(name: string, fn: (level: PantoLevel) => void): void;
  onLevel(fn: (level: PantoLevel) => void): void;
  onStop(fn: () => void): void;
  stop(): void;
};
declare const me: PantoHandle;
declare const it: PantoHandle;
/** Sprachausgabe. Das Promise erfüllt sich, wenn fertig gesprochen ist. */
declare function speak(text: string, options?: { interrupt?: boolean; lang?: string; rate?: number; pitch?: number }): Promise<void>;
interface SoundHandle { stop(): void; readonly ended: Promise<void> }
declare const sound: {
  beep(freq?: number, ms?: number, options?: { volume?: number; type?: OscillatorType }): Promise<void>;
  tick(): Promise<void>;
  success(): Promise<void>;
  error(): Promise<void>;
  /** Spielt einen hochgeladenen Sound über seinen Dateinamen, z. B. sound.play("treffer.wav"). */
  play(name: string, options?: { volume?: number; loop?: boolean; rate?: number }): SoundHandle;
  /** Lädt Sounds vorab, damit der erste Ton sofort kommt. */
  preload(...names: string[]): Promise<unknown>;
  stopAll(): void;
  /** Dateinamen aller hochgeladenen Sounds. */
  readonly names: string[];
};
/** Führt fn einmal nach ms Millisekunden aus. Gibt eine Abbrechen-Funktion zurück. */
declare function after(ms: number, fn: () => void, options?: { persistent?: boolean }): () => void;
/** Führt fn alle ms Millisekunden aus. Gibt eine Abbrechen-Funktion zurück. */
declare function every(ms: number, fn: () => void, options?: { persistent?: boolean }): () => void;
/** await wait(1000) wartet eine Sekunde. */
declare function wait(ms: number): Promise<void>;
/** Tastatur, z. B. onKey("Enter", …), onKey("Space", …), onKey("a", …), onKey("*", …) */
declare function onKey(key: string, fn: (key: string, event: KeyboardEvent) => void, options?: { persistent?: boolean }): () => void;
/** Sprachbefehle (Chrome/Edge). listen(["start", "stopp"], (befehl) => …) */
declare function listen(commands: string[] | null, fn: (command: string, text: string) => void): () => void;
declare const ui: {
  /** Haptische Liste: eine Schiene, jeder Eintrag rastet ein. Enter/Leertaste wählt aus. */
  menu<T>(items: T[], options?: {
    x?: number; y?: number; spacing?: number; width?: number; title?: string; strength?: number;
    moveHandle?: boolean; announceIndex?: boolean;
    onSelect?: (item: T, index: number, menu: any) => void;
    onFocus?: (item: T, index: number, menu: any) => void;
  }): { items: T[]; focused: number; length: number; select(i?: number): void; setItems(items: T[]): void; remove(): void };
  /** Fragt nach einer Texteingabe (Tastatur). */
  prompt(question: string, defaultValue?: string): Promise<string | null>;
};
/** Dauerhafter Speicher im Browser (pro Projekt). */
declare const storage: { get<T = any>(key: string, fallback?: T): T; set(key: string, value: any): void; remove(key: string): void };
/** Freies Objekt, dessen Werte über Level-Wechsel erhalten bleiben. */
declare const state: Record<string, any>;
declare function log(...values: any[]): void;
declare function random(min?: number, max?: number): number;
/** Zufälliger Punkt, den der Griff erreicht (Standard: beide), mindestens margin mm vom Rand. */
declare function randomPoint(margin?: number, handle?: 'me' | 'it' | 'both'): { x: number; y: number };
declare function distance(a: Point | PantoHandle, b: Point | PantoHandle): number;
`;

const code = (s) => `<pre><code>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`;

export const API_HTML = `
<section>
  <h3>Grundidee</h3>
  <p>Ein Projekt besteht aus einem <b>Skript</b> und beliebig vielen <b>Leveln</b>. Level zeichnest du im Level-Editor (Wände, Schienen, Zonen), das Verhalten schreibst du im Skript. Alle Maße sind Millimeter; der Ursprung ist oben links, die Arbeitsfläche ist ${360}&nbsp;×&nbsp;${210}&nbsp;mm.</p>
  <p><b>me</b> ist der Griff, den die Person führt. <b>it</b> ist der Griff, den dein Programm bewegt.</p>
  <p>Beim Start läuft das Haupt-Skript einmal von oben nach unten, danach wird das Start-Level geladen. Jedes Level kann zusätzlich ein eigenes Skript haben.</p>
</section>
<section>
  <h3>Haupt-Skript und Level-Skripte</h3>
  <p>Es gibt ein <b>Haupt-Skript</b> und pro Level ein eigenes <b>Level-Skript</b> (Tab „Skript“, wenn ein Level geöffnet ist).</p>
  <p>Das Haupt-Skript läuft einmal beim Start: Begrüßung, Spielstand, Tasten, die überall gelten, und das Umschalten zwischen Leveln. Das Level-Skript läuft jedes Mal, wenn genau dieses Level geladen wird. Dort ist <code>level</code> schon da, und alles, was es anlegt, wird beim Level-Wechsel automatisch aufgeräumt.</p>
  ${code(`// Haupt-Skript
state.punkte = 0;
speak("Willkommen!");
onKey("r", () => panto.loadLevel("Gang"));

// Level-Skript von "Gang"
level.zone("Ausgang").onEnter(() => panto.nextLevel());
every(1000, () => log(me.position));`)}
  <p>Reihenfolge beim Laden eines Levels: Objekte anlegen → Level-Skript → <code>panto.onLevel</code>-Funktionen aus dem Haupt-Skript → Griffe fahren zu den Startpunkten, Intro wird gesprochen.</p>
</section>
<section>
  <h3>Spielfeld</h3>
  <p>Die Griffe erreichen nicht die ganze Fläche, und <b>Me</b> und <b>It</b> haben unterschiedliche Bereiche (gestrichelt: orange = Me, lila = It). Nur in der Mitte überschneiden sie sich. Der Rand des Me-Bereichs ist automatisch eine Wand. <code>moveTo</code> auf einen unerreichbaren Punkt fährt zum nächsten erreichbaren Punkt.</p>
  ${code(`me.canReach({x: 300, y: 60})      // false
panto.canReach(p, "both")          // für Me und It erreichbar?
randomPoint(15)                    // Punkt, den beide erreichen
randomPoint(15, "me")              // nur Me
panto.area("it").points            // Umriss als Punktliste`)}
  <p>Beim Laden warnt die Konsole, wenn Zonen, Schienen oder Startpunkte außerhalb liegen. Wände dürfen über den Rand hinausragen.</p>
  <p>Im Level-Editor zoomst du mit dem Mausrad zum Zeiger, verschiebst durch Ziehen auf leerer Fläche und holst mit <code>0</code> die ganze Fläche bzw. mit <code>F</code> die Auswahl zurück.</p>
</section>
<section>
  <h3>Griffe</h3>
  ${code(`me.position            // {x, y} – was die Person fühlt
me.onMove(pos => log(pos))
await it.moveTo({x: 180, y: 100}, { speed: 120 })  // mm/s
await me.moveTo(zone.center)   // Me wird danach wieder freigegeben
it.free(); it.freeze()
me.distanceTo(it)`)}
</section>
<section>
  <h3>Level</h3>
  ${code(`panto.onLevel("Gang", (level) => {
  level.zone("Ausgang").onEnter(() => panto.loadLevel("Schiene"));
});
panto.loadLevel("Gang");   panto.nextLevel();
panto.level.name           panto.levels   // alle Namen
state.punkte = 0           // bleibt über Level hinweg erhalten`)}
  <p>Zonen mit einem Text unter „Beim Betreten sagen“ sprechen automatisch.</p>
</section>
<section>
  <h3>Objekte im Code</h3>
  ${code(`const tuer = panto.wall([[100, 20], [100, 120]]);
tuer.disable();   tuer.enable();   tuer.remove();
panto.box(20, 20, 80, 40, { passable: true });
panto.circle(180, 100, 25);
panto.rail([[40, 170], [180, 170], [180, 50]], { strength: 8 });
const z = panto.zone({ x: 300, y: 20, w: 40, h: 40 }, { speak: "Ziel" });
z.onEnter(() => sound.success());`)}
  <p><code>handles: "me"</code> oder <code>"it"</code> lässt ein Hindernis nur für einen Griff gelten.</p>
</section>
<section>
  <h3>Ausgabe &amp; Eingabe</h3>
  ${code(`await speak("Hallo");   speak("Sofort", { interrupt: true });
sound.beep(440, 150);   sound.tick();   sound.success();
onKey("Enter", () => …);  onKey("Space", …);  onKey("n", …)
listen(["start", "stopp"], (cmd) => …)    // Spracheingabe
const name = await ui.prompt("Wie heißt du?");`)}
</section>
<section>
  <h3>Sounds</h3>
  <p>In der Seitenleiste unter „Sounds“ lädst du MP3- oder WAV-Dateien hoch (oder ziehst sie hinein). Im Skript sprichst du sie über ihren Dateinamen an. Ein Klick auf den Namen in der Liste fügt die passende Zeile ins offene Skript ein.</p>
  ${code(`sound.play("treffer.wav");
const musik = sound.play("hintergrund.mp3", { volume: 0.3, loop: true });
musik.stop();
await sound.play("gong.wav").ended;     // warten, bis der Ton zu Ende ist
await sound.preload("treffer.wav");     // vorher laden, dann ohne Verzögerung
sound.stopAll();   sound.names          // alle hochgeladenen Dateinamen`)}
  <p>Die Dateien liegen im Browser (IndexedDB), nicht auf einem Server. Beim Export des Projekts kommen sie in die Projektdatei mit, beim Stopp werden laufende Sounds beendet.</p>
</section>
<section>
  <h3>Zeit</h3>
  ${code(`after(1000, () => speak("Eine Sekunde später"));
const stop = every(500, () => …);  stop();
await wait(2000);`)}
</section>
<section>
  <h3>Apps: Menüs &amp; Listen</h3>
  ${code(`const menu = ui.menu(["Neu", "Öffnen", "Beenden"], {
  title: "Hauptmenü", y: 40, spacing: 30,
  onSelect: (item, i) => speak(item + " gewählt"),
});
menu.setItems([...]);   menu.focused   menu.remove();
storage.set("notizen", liste);   storage.get("notizen", [])`)}
  <p>Das Menü legt eine Schiene an, auf der jeder Eintrag einrastet und angesagt wird. Enter oder Leertaste wählt aus.</p>
</section>
<section>
  <h3>Emulator</h3>
  <p>Ohne Gerät: <b>Me</b> mit der Maus ziehen, <b>It</b> mit Shift&nbsp;+&nbsp;Ziehen oder rechter Maustaste. Der gefüllte Kreis ist das „God Object“ (was die Person fühlt), der gestrichelte Kreis die echte Griffposition.</p>
</section>
`;
