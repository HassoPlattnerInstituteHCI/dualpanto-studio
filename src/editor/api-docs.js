// API reference: TypeScript declarations for autocompletion in the code editor
// and the human-readable reference shown in the "API" tab.

export const API_DTS = `
type Point = { x: number; y: number } | [number, number];
/** Überall, wo ein Ziel erwartet wird: Punkt, Gegner/Item, Zone, Griff – oder eine Funktion, die einen Punkt liefert. */
type Target = Point | PantoEntity | PantoZone | PantoHandle | (() => Point);
type Handles = 'both' | 'me' | 'it';

interface FollowOptions {
  /** Obergrenze in mm/s für die Anfahrt und für Sprünge des Ziels (Standard 120). */
  speed?: number;
  /** Drehung: eine Zahl, oder true für die Drehung des Ziels. */
  rotation?: number | true;
  /** Aktualisierungen pro Sekunde (Standard 20). Weniger = weniger Pakete. */
  hz?: number;
  /**
   * Wie viele Update-Intervalle eine Fahrt dauert (Standard 2.5). Werte unter 1.5
   * machen den Griff unruhig: jede Fahrt ist dann zu Ende, bevor das nächste Ziel
   * kommt, und der Griff pulsiert mit der Update-Rate. Größer = ruhiger, träger.
   */
  ease?: number;
  /** Glättung des Ziels 0..0.95 (Standard 0.25; ist das Ziel ein Griff: 0.6). */
  smooth?: number;
  /** Vorhalt: Anteil der Fahrtdauer, um den vorausgezielt wird (Standard 0.6). */
  lead?: number;
  /** Erst senden, wenn sich das Ziel um so viele mm bewegt hat (Standard 1). */
  deadzone?: number;
}

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
  distanceTo(p: Target): number;
  /** true, wenn der Griff den Punkt physisch erreichen kann. */
  canReach(p: Target): boolean;
  /** Umriss des Bereichs, den dieser Griff erreichen kann (mm). */
  readonly area: { x: number; y: number }[] | null;
  /** Wird bei jeder Bewegung des Griffs aufgerufen. */
  onMove(fn: (pos: { x: number; y: number }) => void): () => void;
  /** Bewegt den Griff (speed in mm/s). Me wird danach freigegeben, It bleibt stehen (hold). */
  moveTo(p: Target, options?: { speed?: number; duration?: number; rotation?: number; hold?: boolean }): Promise<boolean>;
  /**
   * Fährt zum Objekt und bleibt dann an ihm: bewegt sich das Objekt, fährt der Griff mit
   * (wie SwitchTo im Unity-Toolkit). Das Promise erfüllt sich beim ersten Ankommen.
   * Endet mit free(), freeze(), stopFollow() oder dem nächsten switchTo.
   * hz = Aktualisierungen pro Sekunde (Standard 30), speed = Obergrenze in mm/s.
   */
  switchTo(target: Target, options?: FollowOptions): Promise<boolean>;
  /** Gleiche Wirkung wie switchTo. */
  follow(target: Target, options?: FollowOptions): Promise<boolean>;
  /** Beendet nur das Folgen; der Griff bleibt stehen. */
  stopFollow(): this;
  readonly isFollowing: boolean;
  /** Punkt, dem der Griff folgt, oder null. */
  readonly followTarget: { x: number; y: number } | null;
  /** Name des Objekts, dem gefolgt wird, oder null. */
  readonly followName: string | null;
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

type EntityKind = 'enemy' | 'item' | 'marker';

interface PantoEntity {
  readonly name: string;
  readonly kind: EntityKind;
  /** Mittelpunkt in mm. Zuweisen setzt das Objekt sofort dorthin. */
  position: { x: number; y: number };
  readonly x: number;
  readonly y: number;
  /** Berührungsradius in mm. */
  radius: number;
  /** true, solange es sich bewegt (moveTo, patrol, follow). */
  readonly isMoving: boolean;
  /** false, wenn versteckt oder eingesammelt. */
  readonly isVisible: boolean;
  readonly collected: boolean;
  /** Fährt zum Punkt (speed in mm/s). Erfüllt sich beim Ankommen. */
  moveTo(p: Point | PantoEntity | PantoHandle, options?: { speed?: number; duration?: number }): Promise<boolean>;
  moveBy(dx: number, dy: number, options?: { speed?: number; duration?: number }): Promise<boolean>;
  /** Setzt es ohne Animation an eine Stelle. */
  moveToNow(p: Point | PantoEntity | PantoHandle): this;
  /** Läuft die Punkte immer wieder ab (pingpong: hin und zurück). */
  patrol(points: Point[], options?: { speed?: number; loop?: boolean; pingpong?: boolean }): this;
  /** Folgt einem Griff, einem anderen Objekt oder einem Punkt. */
  follow(target: PantoHandle | PantoEntity | Point, options?: { speed?: number; distance?: number }): this;
  /** Stoppt Bewegung und Verfolgung. */
  halt(): this;
  /** Kurz für it.switchTo(entity): der Griff fährt hin und bleibt am Objekt. */
  attachTo(handle?: 'it' | 'me', options?: { speed?: number; hz?: number }): this;
  detach(): this;
  /** Runde Wand auf dem Gerät an- oder abschalten. */
  setSolid(on?: boolean): this;
  distanceTo(p: Point | PantoEntity | PantoHandle): number;
  touching(handle?: 'me' | 'it'): boolean;
  /** Wird aufgerufen, wenn ein Griff das Objekt berührt. */
  onTouch(fn: (handle: PantoHandle, entity: PantoEntity) => void): () => void;
  onLeave(fn: (handle: PantoHandle, entity: PantoEntity) => void): () => void;
  /** Wird aufgerufen, wenn es eingesammelt wird (Items automatisch). */
  onCollect(fn: (handle: PantoHandle, entity: PantoEntity) => void): () => void;
  /** Sammelt es ein: es verschwindet und reagiert nicht mehr. */
  collect(): this;
  /** Holt ein verstecktes oder eingesammeltes Objekt zurück. */
  reset(p?: Point): this;
  show(): this; hide(): this; enable(): this; disable(): this; remove(): void;
}

interface EntityOptions {
  x?: number; y?: number;
  /** Berührungsradius in mm (Standard 10). */
  r?: number;
  name?: string;
  kind?: EntityKind;
  /** Wird beim Berühren gesagt. */
  speak?: string;
  /** Dateiname eines hochgeladenen Sounds, wird beim Berühren gespielt. */
  sound?: string;
  /** true: runde Wand auf dem Gerät, das Objekt ist fühlbar. */
  solid?: boolean;
  /** Items: verschwinden beim Berühren (Standard true). */
  vanish?: boolean;
  /** Welcher Griff auslöst (Standard "me"). */
  handle?: 'me' | 'it' | 'both';
  enabled?: boolean;
  persistent?: boolean;
}

interface PantoLevel {
  readonly name: string;
  readonly objects: Array<PantoObstacle | PantoZone | PantoEntity>;
  /** Zone dieses Levels über ihren Namen aus dem Level-Editor. */
  zone(name: string): PantoZone;
  /** Gegner, Item oder Markierung über den Namen aus dem Level-Editor. */
  entity(name: string): PantoEntity;
  /** Beliebiges Objekt dieses Levels über seinen Namen. */
  object(name: string): PantoObstacle | PantoZone | PantoEntity | null;
  zones(): PantoZone[];
  entities(kind?: EntityKind): PantoEntity[];
  enemies(): PantoEntity[];
  items(): PantoEntity[];
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
  /** Sichtbares Objekt: panto.entity(x, y, { … }) oder panto.entity({ x, y, … }). */
  entity(x: number, y: number, options?: EntityOptions): PantoEntity;
  entity(options: EntityOptions): PantoEntity;
  /** Gegner (rotes Dreieck). Kurz für panto.entity(…, { kind: "enemy" }). */
  enemy(x: number, y: number, options?: EntityOptions): PantoEntity;
  enemy(options: EntityOptions): PantoEntity;
  /** Item zum Einsammeln (grüne Raute). */
  item(x: number, y: number, options?: EntityOptions): PantoEntity;
  item(options: EntityOptions): PantoEntity;
  /** Alle Entities der Szene, optional nach Art. */
  entities(kind?: EntityKind): PantoEntity[];
  /** Objekt der Szene über seinen Namen – geht auch im Haupt-Skript, wo es kein "level" gibt. */
  find(name: string): PantoObstacle | PantoZone | PantoEntity | null;
  /** Alle Objekte der Szene, optional nach Typ. */
  objects(type?: 'wall' | 'rail' | 'zone' | 'entity'): Array<PantoObstacle | PantoZone | PantoEntity>;
  loadLevel(name: string): Promise<PantoLevel | null>;
  nextLevel(): Promise<PantoLevel | null>;
  /** Ein Level nur im Code – ohne Eintrag im Level-Editor. */
  defineLevel(name: string, build: (level: PantoLevel) => void | Promise<void>,
              options?: { spawn?: { me?: Point; it?: Point }; intro?: string }): string;
  /** Läuft in jedem Bild (ca. 60 mal pro Sekunde). dt = Sekunden seit dem letzten Bild. */
  onFrame(fn: (dt: number, time: number) => void, options?: { persistent?: boolean }): () => void;
  /** Sekunden seit dem Start. */
  readonly time: number;
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
/** Sprachbefehle, einfache Variante. listen(["start", "stopp"], (befehl) => …), listen(null, (text) => …) */
declare function listen(commands: string[] | null, fn: (command: string, text: string) => void): () => void;

/**
 * Spracheingabe (Chrome/Edge). Muster mit Platzhaltern statt Sprachmodell:
 *   "gehe zu {ziel}"        – {ziel} ist der Rest des Satzes
 *   "setze punkte {n:zahl}" – versteht "drei" und "3"
 *   "(start|starte) spiel"  – Alternativen
 *   "*"                     – alles, was zu keinem anderen Muster passt
 * Umlaute, Beugungen und Füllwörter werden toleriert.
 */
declare const voice: {
  /** true in Chrome und Edge am Computer. */
  readonly supported: boolean;
  /** "off" | "listening" | "paused" | "error" */
  readonly state: string;
  readonly isListening: boolean;
  /** Der letzte erkannte Satz. */
  readonly lastText: string;
  /** Registriert einen Sprachbefehl. fn(platzhalter, originaltext). */
  command(pattern: string, fn: (args: Record<string, any>, text: string) => void, options?: { persistent?: boolean }): () => void;
  /** Mehrere auf einmal: voice.commands({ "start": fn, "stopp": fn }) */
  commands(map: Record<string, (args: Record<string, any>, text: string) => void>, options?: { persistent?: boolean }): () => void;
  /** Jeder erkannte Satz, ohne Muster. */
  onText(fn: (text: string, original: string, alternativen: string[]) => void, options?: { persistent?: boolean }): () => void;
  /** Zwischenergebnis, noch während gesprochen wird. */
  onPartial(fn: (text: string, original: string) => void, options?: { persistent?: boolean }): () => void;
  /**
   * Stellt eine Frage, wartet auf die Antwort, gibt null zurück, wenn nichts verstanden wurde.
   * expect: "text" (Standard), "zahl" oder eine Liste erlaubter Antworten.
   */
  ask(question: string, options?: { expect?: 'text' | 'zahl' | string[]; timeout?: number; retries?: number; lang?: string }): Promise<any>;
  /** Ja/Nein-Frage: true, false oder null. */
  confirm(question: string, options?: { timeout?: number; retries?: number }): Promise<boolean | null>;
  /** Taste halten = zuhören. Verhindert Fehlauslöser durch die eigene Sprachausgabe. */
  pushToTalk(key?: string, options?: { persistent?: boolean }): () => void;
  /** Startet das Mikrofon (passiert bei command/onText automatisch). local: Erkennung auf dem Gerät. */
  start(options?: { lang?: string; continuous?: boolean; interim?: boolean; local?: boolean; minScore?: number }): void;
  stop(): void;
  /** "available" | "downloadable" | "downloading" | "unavailable" | "unknown" */
  localAvailable(lang?: string): Promise<string>;
  /** Lädt das Sprachpaket für die Erkennung ohne Server (einmal Internet nötig). */
  installLocal(lang?: string): Promise<boolean>;
  /** So lange nach der eigenen Sprachausgabe gilt ein ähnlicher Satz als Echo (ms, Standard 1500). */
  echoWindow: number;
};
/** "dreiundzwanzig" → 23, "3,5" → 3.5, sonst null. */
declare function parseNumber(text: string): number | null;
/** Bester Treffer aus einer Liste, tolerant gegen Erkennungsfehler. */
declare function matchText<T>(text: string, options: T[], minScore?: number): { option: T; score: number } | null;
declare function normalizeText(text: string): string;
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
  <p>Als Ziel geht überall dasselbe: ein Punkt, ein Gegner oder Item, eine Zone, der andere Griff – oder eine Funktion, die einen Punkt liefert.</p>
</section>
<section>
  <h3>Ein Griff hängt an einem Objekt</h3>
  <p><code>switchTo</code> fährt den Griff zum Objekt und lässt ihn dann <b>daran hängen</b>: bewegt sich das Objekt, fährt der Griff mit. Das ist das Gegenstück zu <code>PantoHandle.SwitchTo</code> im Unity-Toolkit und der Weg, einen Gegner fühlbar zu machen – die Person ertastet ihn am It-Griff.</p>
  ${code(`const gegner = level.entity("Wächter");
gegner.patrol([[150, 80], [210, 140]], { speed: 60 });

await it.switchTo(gegner);              // fährt hin, erfüllt sich beim Ankommen
it.isFollowing   it.followName          // true, "Wächter"
it.stopFollow();                        // bleibt stehen
it.free();                              // loslassen (beendet das Folgen auch)

it.switchTo(level.zone("Ziel"));                       // Mittelpunkt der Zone
it.switchTo(() => ({ x: 200, y: 110 + panto.time }));  // eigene Kurve
me.switchTo(gegner);                                   // führt die Hand der Person mit`)}
  <p>Am Gerät sind das ungefähr 17 Pakete pro Sekunde, solange sich das Ziel bewegt – das Unity-Toolkit schickt 50. Steht das Objekt still, wird nichts geschickt. Läuft das Ziel aus dem erreichbaren Bereich des Griffs, bleibt der Griff am nächsten erreichbaren Punkt und die Konsole sagt es einmal.</p>
  <h4>Wenn der Griff unruhig läuft</h4>
  <p>Die Firmware fährt das God Object in <code>1 / SPEED</code> Sekunden zum Ziel. Dauert eine Fahrt nur ein Update-Intervall, ist sie vorbei, bevor das nächste Ziel kommt – der Griff fährt in kleinen Stößen und pulsiert mit der Update-Rate. Deshalb dauert jede Fahrt standardmäßig <b>2,5 Intervalle</b> (<code>ease</code>), die Fahrten überlappen sich also; den Nachlauf gleicht ein <b>Vorhalt</b> aus (<code>lead</code>), und ein verrauschtes Ziel wird <b>geglättet</b> (<code>smooth</code>).</p>
  ${code(`it.switchTo(gegner, {
  speed: 150,     // Obergrenze mm/s – für die Anfahrt und für Sprünge
  hz: 20,         // Aktualisierungen pro Sekunde
  ease: 2.5,      // Fahrtdauer in Intervallen: größer = ruhiger, träger
  smooth: 0.25,   // Glättung des Ziels (bei einem Griff als Ziel: 0.6)
  lead: 0.6,      // Vorhalt gegen den Nachlauf
  deadzone: 1,    // erst senden, wenn sich das Ziel 1 mm bewegt hat
});`)}
  <p>Zuckt es trotzdem: <code>ease</code> auf 3–4 und <code>hz</code> auf 12–15. Hängt der Griff zu weit hinterher: <code>ease</code> kleiner (nicht unter 1.5) oder <code>lead</code> auf 1. Zappelt das Ziel (die Hand der Person, Sensorwerte): <code>smooth</code> auf 0.6–0.8.</p>
  <p><code>entity.attachTo("it")</code> ist die Kurzform für <code>it.switchTo(entity)</code>.</p>
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
  <h3>Objekte im Code – jederzeit zur Laufzeit</h3>
  <p>Der Level-Editor ist nur eine Abkürzung. <b>Alles</b> lässt sich im Skript anlegen, verändern und wieder entfernen – beim Start, in einem Timer, in <code>onFrame</code>, in der Reaktion auf eine Zone, auf eine Taste oder auf einen Sprachbefehl. Was entsteht, geht sofort an das Gerät (bzw. den Emulator) und erscheint in der Vorschau.</p>
  ${code(`const tuer = panto.wall([[150, 60], [150, 140]], { name: "Tür" });
panto.box(200, 95, 30, 25, { name: "Kiste" });
panto.circle(260, 120, 18);
panto.rail([[140, 160], [280, 160]], { strength: 8 });
const z = panto.zone({ x: 250, y: 60, r: 16 }, { name: "Ziel", speak: "Am Ziel" });
const gegner = panto.enemy(170, 100, { name: "Feind" });
const muenze = panto.item(230, 140, { name: "Münze" });

tuer.disable();   tuer.enable();   tuer.remove();     // jederzeit
after(2000, () => panto.box(120, 100, 20, 20));       // später nachlegen
onKey("n", () => panto.circle(randomPoint(20).x, randomPoint(20).y, 12));
z.onEnter(() => panto.enemy(randomPoint(20), { name: "Verstärkung" }));`)}
  <p><b>Wiederfinden:</b> über den Namen, egal ob gezeichnet oder im Code angelegt.</p>
  ${code(`level.object("Tür");  level.zone("Ziel");  level.entity("Feind");
level.items();  level.enemies();  level.zones();
panto.find("Feind");       // geht auch im Haupt-Skript, wo es kein "level" gibt
panto.objects("wall");     // alle Wände der Szene`)}
  <p><b>Aufräumen</b> passiert automatisch und hängt davon ab, <i>wo</i> etwas angelegt wird: im <b>Level-Skript</b> gehört es zum Level und verschwindet beim Level-Wechsel; im <b>Haupt-Skript</b> bleibt es über Level hinweg stehen. <code>{ persistent: true }</code> macht ein Objekt auch aus einem Level-Skript dauerhaft. Beim Stopp wird alles entfernt.</p>
  <p><code>handles: "me"</code> oder <code>"it"</code> lässt ein Hindernis nur für einen Griff gelten.</p>
  <p><b>Am echten Gerät kostet jedes Hindernis Pakete:</b> eine Wand ist ein CREATE, ein Paket pro Punkt und ein ENABLE, und zwischen zwei solchen Paketen liegen 10&nbsp;ms. Eine Linie aus 2 Punkten braucht so ungefähr 40&nbsp;ms, ein <code>panto.circle</code> mit 16 Ecken knapp 200&nbsp;ms. Für etwas, das sich oft ändert, ist es deshalb besser, die Hindernisse <b>einmal anzulegen und nur ein- und auszuschalten</b> (je ein Paket) statt sie ständig neu zu erzeugen. Zonen und Entities kosten gar nichts – die rechnet das Studio selbst.</p>
</section>
<section>
  <h3>Gegner, Items &amp; eigene Objekte</h3>
  <p>Ein <b>Entity</b> ist ein sichtbares Objekt in der Szene: ein Gegner (rotes Dreieck), ein Item (grüne Raute) oder eine Markierung. Entities hängen <b>nicht</b> am Gerät – sie werden im Level-Editor und in der Vorschau gezeichnet und reagieren, wenn der Me-Griff in ihren Radius kommt. Das reicht für Spiele mit Ton- und Sprachausgabe.</p>
  <p>Im Level-Editor setzt du sie mit den Werkzeugen <b>Gegner</b> (G) und <b>Item</b> (I) und gibst ihnen einen Namen. Im Skript holst du sie über diesen Namen:</p>
  ${code(`const gegner = level.entity("Gegner 1");
gegner.patrol([[140, 80], [260, 80]], { speed: 40 });   // hin und her
gegner.onTouch(() => speak("Erwischt!"));

level.entity("Item 1").onCollect(() => {
  state.punkte = (state.punkte ?? 0) + 1;
  speak(\`\${state.punkte} von \${level.items().length}\`);
});

level.items()      // alle Items   level.enemies()   level.entities()`)}
  <p>Genauso gut legst du sie im Code an – dann brauchst du den Editor gar nicht:</p>
  ${code(`const muenze = panto.item(200, 80, { name: "Münze", r: 12, speak: "Münze!" });
const jaeger = panto.enemy(140, 70, { r: 14 });
jaeger.follow(me, { speed: 30 });          // verfolgt den Me-Griff
const ziel  = panto.entity({ x: 270, y: 150, name: "Ziel" });

await muenze.moveTo({ x: 160, y: 150 }, { speed: 80 });
muenze.moveToNow(randomPoint(15));         // ohne Animation
muenze.collect();  muenze.reset();         // einsammeln / zurückholen
jaeger.halt();  jaeger.hide();  jaeger.remove();
muenze.position   muenze.radius = 16   muenze.distanceTo(me)   muenze.touching()`)}
  <p><b>Fühlbar machen</b> – zwei Wege, beide optional:</p>
  <ul>
    <li><code>solid: true</code> (oder <code>setSolid()</code>) legt eine runde Wand an. Bewegte Objekte überträgt die Runtime am Gerät erst beim Anhalten – ein Hindernis neu zu senden kostet Pakete.</li>
    <li><code>attachTo("it")</code> schickt den It-Griff dauernd zum Objekt. Damit kann die Person es direkt ertasten, z. B. den Gegner, der sie jagt.</li>
  </ul>
  ${code(`panto.enemy(150, 90, { name: "Wächter", solid: true });
level.entity("Wächter").attachTo("it");   // It fährt mit
level.entity("Wächter").detach();`)}
  <p>Ohne eine Zeile Code gilt: ein Item verschwindet beim Berühren und piept, ein Gegner brummt. Ein Text unter „Beim Berühren sagen“ wird gesprochen, ein gewählter Sound abgespielt.</p>
</section>
<section>
  <h3>Eigene Level im Code</h3>
  <p>Wer lieber programmiert, baut Level komplett im Skript – zufällig erzeugt, aus Daten, oder beliebig viele hintereinander. <code>panto.defineLevel</code> macht so ein Level unter einem Namen bekannt, danach funktioniert <code>panto.loadLevel</code> wie bei gezeichneten Leveln.</p>
  ${code(`panto.defineLevel("Arena", (level) => {
  panto.box(170, 95, 35, 28, { name: "Kiste" });
  for (let i = 0; i < 5; i++) panto.item(randomPoint(20), { name: "Münze " + i });
  const jaeger = panto.enemy(randomPoint(20), { name: "Jäger", r: 14 });
  jaeger.follow(me, { speed: 25 });
  jaeger.onTouch(() => panto.loadLevel("Arena"));   // neuer Versuch

  panto.onFrame((dt) => {                            // eigene Spiellogik
    if (!level.items().some((it) => it.isVisible)) speak("Alles eingesammelt!");
  });
}, { spawn: { me: { x: 130, y: 80 } }, intro: "Arena. Sammle die Münzen." });

panto.loadLevel("Arena");
panto.time        // Sekunden seit dem Start`)}
  <p><code>panto.onFrame(fn)</code> läuft etwa 60 mal pro Sekunde; <code>dt</code> ist die Zeit seit dem letzten Bild in Sekunden – gut für eigene Bewegungen, Timer und Kollisionen. Alles, was im Builder angelegt wird, räumt die Runtime beim Level-Wechsel wieder auf.</p>
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
  <h3>Spracheingabe</h3>
  <p>Das Mikrofon gibt es in Chrome und Edge am Computer – denselben Browsern wie Web Serial. Oben rechts steht, ob gerade zugehört wird; ein Klick darauf schaltet es an und aus. Beim ersten Mal fragt der Browser nach der Erlaubnis.</p>
  <p>Interpretiert wird mit <b>Mustern</b>, nicht mit einem Sprachmodell. Platzhalter <code>{name}</code> holen Teile des Satzes heraus, <code>{name:zahl}</code> macht daraus eine Zahl (<code>„dreiundzwanzig“</code> → <code>23</code>), runde Klammern erlauben Alternativen. Füllwörter, Beugungen („startet“ statt „start“) und Umlaut-Schreibweisen werden toleriert.</p>
  ${code(`voice.command("(start|starte|los) spiel", () => panto.loadLevel("Arena"));
voice.command("gehe zu {ziel}", ({ ziel }) => speak("Ich suche " + ziel));
voice.command("setze punkte {n:zahl}", ({ n }) => state.punkte = n);
voice.command("*", ({ text }) => log("nicht verstanden: " + text));   // Auffangmuster

voice.onText((text) => log("gehört: " + text));      // jeder Satz
voice.onPartial((text) => …);                        // schon während des Sprechens
voice.lastText     voice.isListening     voice.state`)}
  <p><b>Fragen stellen</b> – besser als <code>ui.prompt</code>, wenn niemand die Tastatur sieht. Die Frage wird gesprochen, danach wird zugehört; ohne Antwort kommt <code>null</code> zurück.</p>
  ${code(`const text  = await voice.ask("Wie heißt die Aufgabe?");
const punkte = await voice.ask("Wie viele Punkte?", { expect: "zahl" });
const farbe  = await voice.ask("Welche Farbe?", { expect: ["rot", "grün", "blau"] });
if (await voice.confirm("Wirklich löschen?")) …
const egal = await ui.askVoice("Name?");   // Sprache, sonst Tastatur`)}
  <p><b>Zwei Fallen</b>, die wir abgefangen haben:</p>
  <ul>
    <li><b>Das Programm spricht selbst.</b> Das Mikrofon hört <code>speak()</code> mit. Ergebnisse, die während oder bis <code>voice.echoWindow</code> ms nach der eigenen Ausgabe kommen und ihr ähnlich sind, werden verworfen (im Geräte-Log sichtbar). Ganz sicher ist <b>Push-to-talk</b>: <code>voice.pushToTalk("v")</code> – Taste halten und sprechen.</li>
    <li><b>Die Erkennung läuft in Chrome über einen Server</b>, das Audio geht also ins Netz und offline geht nichts. <code>voice.localAvailable()</code> sagt, ob dieser Browser auf dem Gerät erkennen kann; <code>voice.installLocal()</code> lädt das Sprachpaket, danach bleibt mit <code>voice.start({ local: true })</code> alles auf dem Rechner. Beim Start steht in der Konsole, was hier gilt.</li>
  </ul>
  <p>Hilfsfunktionen außerhalb von Mustern: <code>parseNumber("fünfundzwanzig")</code>, <code>matchText(text, ["ja", "nein"])</code>, <code>normalizeText(text)</code>. Die alte, einfache Form <code>listen(["start", "stopp"], fn)</code> funktioniert weiter.</p>
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
