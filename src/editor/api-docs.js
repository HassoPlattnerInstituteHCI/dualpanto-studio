// API reference: TypeScript declarations for autocompletion in the code editor
// and the human-readable reference shown in the "API" tab.

export const API_DTS = `
type Point = { x: number; y: number } | [number, number];
/** Wherever a target is expected: a point, enemy/item, zone, handle – or a function that returns a point. */
type Target = Point | PantoEntity | PantoZone | PantoHandle | (() => Point);
type Handles = 'both' | 'me' | 'it';

interface FollowOptions {
  /** Upper limit in mm/s for the approach and for jumps of the target (default 120). */
  speed?: number;
  /** Rotation: a number, or true for the target's rotation. */
  rotation?: number | true;
  /** Updates per second (default 20). Fewer = fewer packets. */
  hz?: number;
  /**
   * How many update intervals one move lasts (default 2.5). Values below 1.5 make
   * the handle restless: every move ends before the next target arrives, and the
   * handle pulses at the update rate. Larger = calmer, more sluggish.
   */
  ease?: number;
  /** Smoothing of the target 0..0.95 (default 0.25; if the target is a handle: 0.6). */
  smooth?: number;
  /** Lead: fraction of the move duration to aim ahead by (default 0.6). */
  lead?: number;
  /** Only send once the target has moved this many mm (default 1). */
  deadzone?: number;
}

interface PantoHandle {
  /** Position the person feels (god object), in mm. */
  readonly position: { x: number; y: number };
  /** Actual handle position (can be inside a wall). */
  readonly handlePosition: { x: number; y: number };
  readonly x: number;
  readonly y: number;
  /** Rotation of the handle in degrees. */
  readonly rotation: number;
  /** true while the program is moving the handle. */
  readonly isMoving: boolean;
  distanceTo(p: Target): number;
  /** true if the handle can physically reach the point. */
  canReach(p: Target): boolean;
  /** Outline of the area this handle can reach (mm). */
  readonly area: { x: number; y: number }[] | null;
  /** Called on every movement of the handle. */
  onMove(fn: (pos: { x: number; y: number }) => void): () => void;
  /** Moves the handle (speed in mm/s). Me is released afterwards, It stays put (hold). */
  moveTo(p: Target, options?: { speed?: number; duration?: number; rotation?: number; hold?: boolean }): Promise<boolean>;
  /**
   * Moves to the object and then stays on it: when the object moves, the handle moves
   * along (like SwitchTo in the Unity toolkit). The promise resolves on first arrival.
   * Ends with free(), freeze(), stopFollow() or the next switchTo.
   * hz = updates per second (default 20), speed = upper limit in mm/s.
   */
  switchTo(target: Target, options?: FollowOptions): Promise<boolean>;
  /** Same as switchTo. */
  follow(target: Target, options?: FollowOptions): Promise<boolean>;
  /** Only stops following; the handle stays where it is. */
  stopFollow(): this;
  readonly isFollowing: boolean;
  /** Point the handle is following, or null. */
  readonly followTarget: { x: number; y: number } | null;
  /** Name of the object being followed, or null. */
  readonly followName: string | null;
  /** Gives control back to the person. */
  free(): void;
  /** Holds the handle at its position. */
  freeze(): void;
  /** Pushes the handle in a direction, strength 0..1. */
  applyForce(dir: Point, strength?: number): void;
  stopForce(): void;
}

interface PantoObstacle {
  readonly id: number; readonly name: string; readonly type: 'wall' | 'rail'; readonly enabled: boolean;
  enable(): this; disable(): this; remove(): void;
}

interface PantoZone {
  readonly name: string; readonly enabled: boolean; readonly center: { x: number; y: number };
  /** Called when a handle enters the zone. */
  onEnter(fn: (handle: PantoHandle) => void): () => void;
  /** Called when a handle leaves the zone. */
  onExit(fn: (handle: PantoHandle) => void): () => void;
  contains(p: Point | PantoHandle): boolean;
  isInside(handle?: 'me' | 'it'): boolean;
  enable(): this; disable(): this; remove(): void;
}

type EntityKind = 'enemy' | 'item' | 'marker';

interface PantoEntity {
  readonly name: string;
  readonly kind: EntityKind;
  /** Centre in mm. Assigning puts the object there immediately. */
  position: { x: number; y: number };
  readonly x: number;
  readonly y: number;
  /** Touch radius in mm. */
  radius: number;
  /** true while it is moving (moveTo, patrol, follow). */
  readonly isMoving: boolean;
  /** false if hidden or collected. */
  readonly isVisible: boolean;
  readonly collected: boolean;
  /** Moves to the point (speed in mm/s). Resolves on arrival. */
  moveTo(p: Point | PantoEntity | PantoHandle, options?: { speed?: number; duration?: number }): Promise<boolean>;
  moveBy(dx: number, dy: number, options?: { speed?: number; duration?: number }): Promise<boolean>;
  /** Puts it somewhere without animation. */
  moveToNow(p: Point | PantoEntity | PantoHandle): this;
  /** Walks the points over and over (pingpong: back and forth). */
  patrol(points: Point[], options?: { speed?: number; loop?: boolean; pingpong?: boolean }): this;
  /** Follows a handle, another object or a point. */
  follow(target: PantoHandle | PantoEntity | Point, options?: { speed?: number; distance?: number }): this;
  /** Stops movement and following. */
  halt(): this;
  /** Shorthand for it.switchTo(entity): the handle moves there and stays on the object. */
  attachTo(handle?: 'it' | 'me', options?: { speed?: number; hz?: number }): this;
  detach(): this;
  /** Turns the round wall on the device on or off. */
  setSolid(on?: boolean): this;
  distanceTo(p: Point | PantoEntity | PantoHandle): number;
  touching(handle?: 'me' | 'it'): boolean;
  /** Called when a handle touches the object. */
  onTouch(fn: (handle: PantoHandle, entity: PantoEntity) => void): () => void;
  onLeave(fn: (handle: PantoHandle, entity: PantoEntity) => void): () => void;
  /** Called when it is collected (automatically for items). */
  onCollect(fn: (handle: PantoHandle, entity: PantoEntity) => void): () => void;
  /** Collects it: it disappears and stops reacting. */
  collect(): this;
  /** Brings back a hidden or collected object. */
  reset(p?: Point): this;
  show(): this; hide(): this; enable(): this; disable(): this; remove(): void;
}

interface EntityOptions {
  x?: number; y?: number;
  /** Touch radius in mm (default 10). */
  r?: number;
  name?: string;
  kind?: EntityKind;
  /** Spoken on touch. */
  speak?: string;
  /** File name of an uploaded sound, played on touch. */
  sound?: string;
  /** true: round wall on the device, the object can be felt. */
  solid?: boolean;
  /** Items: disappear on touch (default true). */
  vanish?: boolean;
  /** Which handle triggers it (default "me"). */
  handle?: 'me' | 'it' | 'both';
  enabled?: boolean;
  persistent?: boolean;
}

interface PantoLevel {
  readonly name: string;
  readonly objects: Array<PantoObstacle | PantoZone | PantoEntity>;
  /** Zone of this level by its name from the level editor. */
  zone(name: string): PantoZone;
  /** Enemy, item or marker by its name from the level editor. */
  entity(name: string): PantoEntity;
  /** Any object of this level by its name. */
  object(name: string): PantoObstacle | PantoZone | PantoEntity | null;
  zones(): PantoZone[];
  entities(kind?: EntityKind): PantoEntity[];
  enemies(): PantoEntity[];
  items(): PantoEntity[];
}

interface ObjectOptions { name?: string; handles?: Handles; enabled?: boolean; /** survives level changes */ persistent?: boolean }

declare const panto: {
  readonly me: PantoHandle;
  readonly it: PantoHandle;
  /** The currently loaded level. */
  readonly level: PantoLevel | null;
  /** Names of all levels of the project. */
  readonly levels: string[];
  /** Size of the working area in mm. */
  readonly width: number;
  readonly height: number;
  readonly device: 'emulator' | 'serial';
  /** Reachable area of a handle. Me and It have different areas. */
  area(handle?: 'me' | 'it'): { points: { x: number; y: number }[] | null; contains(p: Point | PantoHandle): boolean };
  /** Can the handle (or both) reach the point? */
  canReach(p: Point | PantoHandle, handle?: 'me' | 'it' | 'both'): boolean;
  /** Wall along the points. closed: true connects the last point with the first. */
  wall(points: Point[], options?: ObjectOptions & { closed?: boolean; passable?: boolean }): PantoObstacle;
  /** Rectangular wall. */
  box(x: number, y: number, w: number, h: number, options?: ObjectOptions & { passable?: boolean }): PantoObstacle;
  /** Round wall. */
  circle(x: number, y: number, r: number, options?: ObjectOptions & { passable?: boolean; corners?: number }): PantoObstacle;
  /** Haptic rail ("hallway"). strength = capture width in mm. */
  rail(points: Point[], options?: ObjectOptions & { strength?: number }): PantoObstacle;
  /** Invisible area that reacts when a handle enters it. */
  zone(shape: { x: number; y: number; w: number; h: number } | { x: number; y: number; r: number } | Point[],
       options?: { name?: string; speak?: string; handle?: 'me' | 'it' | 'both'; persistent?: boolean }): PantoZone;
  /** Visible object: panto.entity(x, y, { … }) or panto.entity({ x, y, … }). */
  entity(x: number, y: number, options?: EntityOptions): PantoEntity;
  entity(options: EntityOptions): PantoEntity;
  /** Enemy (red triangle). Shorthand for panto.entity(…, { kind: "enemy" }). */
  enemy(x: number, y: number, options?: EntityOptions): PantoEntity;
  enemy(options: EntityOptions): PantoEntity;
  /** Item to collect (green diamond). */
  item(x: number, y: number, options?: EntityOptions): PantoEntity;
  item(options: EntityOptions): PantoEntity;
  /** All entities of the scene, optionally by kind. */
  entities(kind?: EntityKind): PantoEntity[];
  /** Object of the scene by its name – also works in the main script, where there is no "level". */
  find(name: string): PantoObstacle | PantoZone | PantoEntity | null;
  /** All objects of the scene, optionally by type. */
  objects(type?: 'wall' | 'rail' | 'zone' | 'entity'): Array<PantoObstacle | PantoZone | PantoEntity>;
  loadLevel(name: string): Promise<PantoLevel | null>;
  nextLevel(): Promise<PantoLevel | null>;
  /** A level in code only – without an entry in the level editor. */
  defineLevel(name: string, build: (level: PantoLevel) => void | Promise<void>,
              options?: { spawn?: { me?: Point; it?: Point }; intro?: string }): string;
  /** Runs every frame (about 60 times per second). dt = seconds since the last frame. */
  onFrame(fn: (dt: number, time: number) => void, options?: { persistent?: boolean }): () => void;
  /** Seconds since start. */
  readonly time: number;
  /** Runs fn every time the level is loaded. */
  onLevel(name: string, fn: (level: PantoLevel) => void): void;
  onLevel(fn: (level: PantoLevel) => void): void;
  onStop(fn: () => void): void;
  stop(): void;
};
declare const me: PantoHandle;
declare const it: PantoHandle;
/** Speech output. The promise resolves when speaking is done. */
declare function speak(text: string, options?: { interrupt?: boolean; lang?: string; rate?: number; pitch?: number }): Promise<void>;
interface SoundHandle { stop(): void; readonly ended: Promise<void> }
declare const sound: {
  beep(freq?: number, ms?: number, options?: { volume?: number; type?: OscillatorType }): Promise<void>;
  tick(): Promise<void>;
  success(): Promise<void>;
  error(): Promise<void>;
  /** Plays an uploaded sound by its file name, e.g. sound.play("hit.wav"). */
  play(name: string, options?: { volume?: number; loop?: boolean; rate?: number }): SoundHandle;
  /** Loads sounds in advance so the first one plays right away. */
  preload(...names: string[]): Promise<unknown>;
  stopAll(): void;
  /** File names of all uploaded sounds. */
  readonly names: string[];
};
/** Runs fn once after ms milliseconds. Returns a cancel function. */
declare function after(ms: number, fn: () => void, options?: { persistent?: boolean }): () => void;
/** Runs fn every ms milliseconds. Returns a cancel function. */
declare function every(ms: number, fn: () => void, options?: { persistent?: boolean }): () => void;
/** await wait(1000) waits one second. */
declare function wait(ms: number): Promise<void>;
/** Keyboard, e.g. onKey("Enter", …), onKey("Space", …), onKey("a", …), onKey("*", …) */
declare function onKey(key: string, fn: (key: string, event: KeyboardEvent) => void, options?: { persistent?: boolean }): () => void;
/** Voice commands, simple variant. listen(["start", "stop"], (command) => …), listen(null, (text) => …) */
declare function listen(commands: string[] | null, fn: (command: string, text: string) => void): () => void;

/**
 * Voice input (Chrome/Edge). Patterns with placeholders instead of a language model:
 *   "go to {target}"        – {target} is the rest of the sentence
 *   "set score {n:number}"  – understands "three" and "3"
 *   "(start|begin) game"    – alternatives
 *   "*"                     – anything no other pattern matches
 * Filler words, word endings and umlaut spellings are tolerated.
 */
declare const voice: {
  /** true in Chrome and Edge on desktop. */
  readonly supported: boolean;
  /** "off" | "listening" | "paused" | "error" */
  readonly state: string;
  readonly isListening: boolean;
  /** The last recognised sentence. */
  readonly lastText: string;
  /** Registers a voice command. fn(placeholders, original text). */
  command(pattern: string, fn: (args: Record<string, any>, text: string) => void, options?: { persistent?: boolean }): () => void;
  /** Several at once: voice.commands({ "start": fn, "stop": fn }) */
  commands(map: Record<string, (args: Record<string, any>, text: string) => void>, options?: { persistent?: boolean }): () => void;
  /** Every recognised sentence, without patterns. */
  onText(fn: (text: string, original: string, alternatives: string[]) => void, options?: { persistent?: boolean }): () => void;
  /** Interim result while the person is still speaking. */
  onPartial(fn: (text: string, original: string) => void, options?: { persistent?: boolean }): () => void;
  /**
   * Asks a question, waits for the answer, returns null if nothing was understood.
   * expect: "text" (default), "number" or a list of allowed answers.
   */
  ask(question: string, options?: { expect?: 'text' | 'number' | string[]; timeout?: number; retries?: number; lang?: string }): Promise<any>;
  /** Yes/no question: true, false or null. */
  confirm(question: string, options?: { timeout?: number; retries?: number }): Promise<boolean | null>;
  /** Hold a key = listen. Prevents false triggers from the program's own speech output. */
  pushToTalk(key?: string, options?: { persistent?: boolean }): () => void;
  /** Starts the microphone (happens automatically with command/onText). local: on-device recognition. */
  start(options?: { lang?: string; continuous?: boolean; interim?: boolean; local?: boolean; minScore?: number }): void;
  stop(): void;
  /** "available" | "downloadable" | "downloading" | "unavailable" | "unknown" */
  localAvailable(lang?: string): Promise<string>;
  /** Downloads the language pack for recognition without a server (needs internet once). */
  installLocal(lang?: string): Promise<boolean>;
  /** How long after the program's own speech a similar sentence counts as echo (ms, default 1500). */
  echoWindow: number;
};
/** "twenty-three" → 23, "3" → 3, otherwise null. */
declare function parseNumber(text: string): number | null;
/** Best match from a list, tolerant of recognition errors. */
declare function matchText<T>(text: string, options: T[], minScore?: number): { option: T; score: number } | null;
declare function normalizeText(text: string): string;
declare const ui: {
  /** Haptic list: a rail, every item snaps in. Enter/Space selects. */
  menu<T>(items: T[], options?: {
    x?: number; y?: number; spacing?: number; width?: number; title?: string; strength?: number;
    moveHandle?: boolean; announceIndex?: boolean;
    onSelect?: (item: T, index: number, menu: any) => void;
    onFocus?: (item: T, index: number, menu: any) => void;
  }): { items: T[]; focused: number; length: number; select(i?: number): void; setItems(items: T[]): void; remove(): void };
  /** Asks for text input (keyboard). */
  prompt(question: string, defaultValue?: string): Promise<string | null>;
};
/** Persistent storage in the browser (per project). */
declare const storage: { get<T = any>(key: string, fallback?: T): T; set(key: string, value: any): void; remove(key: string): void };
/** Free-form object whose values survive level changes. */
declare const state: Record<string, any>;
declare function log(...values: any[]): void;
declare function random(min?: number, max?: number): number;
/** Random point the handle can reach (default: both), at least margin mm from the edge. */
declare function randomPoint(margin?: number, handle?: 'me' | 'it' | 'both'): { x: number; y: number };
declare function distance(a: Point | PantoHandle, b: Point | PantoHandle): number;
`;

const code = (s) => `<pre><code>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`;

export const API_HTML = `
<section>
  <h3>Basics</h3>
  <p>A project consists of a <b>script</b> and any number of <b>levels</b>. You draw levels in the level editor (walls, rails, zones) and write the behaviour in the script. All measurements are millimetres; the origin is top left, the working area is ${360}&nbsp;×&nbsp;${210}&nbsp;mm.</p>
  <p><b>me</b> is the handle the person moves. <b>it</b> is the handle your program moves.</p>
  <p>On start, the main script runs once from top to bottom, then the start level is loaded. Every level can also have its own script.</p>
</section>
<section>
  <h3>Main script and level scripts</h3>
  <p>There is one <b>main script</b> and one <b>level script</b> per level ("Script" tab when a level is open).</p>
  <p>The main script runs once on start: greeting, score, keys that apply everywhere, and switching between levels. A level script runs every time exactly that level is loaded. There, <code>level</code> is already defined, and everything it creates is cleaned up automatically when the level changes.</p>
  ${code(`// main script
state.score = 0;
speak("Welcome!");
onKey("r", () => panto.loadLevel("Hallway"));

// level script of "Hallway"
level.zone("Exit").onEnter(() => panto.nextLevel());
every(1000, () => log(me.position));`)}
  <p>Order when a level loads: create objects → level script → <code>panto.onLevel</code> functions from the main script → handles move to their start positions, the intro is spoken.</p>
</section>
<section>
  <h3>Play area</h3>
  <p>The handles cannot reach the whole area, and <b>Me</b> and <b>It</b> have different areas (dashed: orange = Me, purple = It). They only overlap in the middle. The edge of the Me area is automatically a wall. <code>moveTo</code> to an unreachable point moves to the nearest reachable point.</p>
  ${code(`me.canReach({x: 300, y: 60})      // false
panto.canReach(p, "both")          // reachable for Me and It?
randomPoint(15)                    // point both can reach
randomPoint(15, "me")              // Me only
panto.area("it").points            // outline as a list of points`)}
  <p>When a level loads, the console warns if zones, rails or start positions are outside. Walls may stick out over the edge.</p>
  <p>In the level editor, the mouse wheel zooms towards the pointer, dragging empty space pans, <code>0</code> shows the whole area and <code>F</code> zooms to the selection.</p>
</section>
<section>
  <h3>Handles</h3>
  ${code(`me.position            // {x, y} – what the person feels
me.onMove(pos => log(pos))
await it.moveTo({x: 180, y: 100}, { speed: 120 })  // mm/s
await me.moveTo(zone.center)   // Me is released again afterwards
it.free(); it.freeze()
me.distanceTo(it)`)}
  <p>Targets work the same everywhere: a point, an enemy or item, a zone, the other handle – or a function that returns a point.</p>
</section>
<section>
  <h3>Attaching a handle to an object</h3>
  <p><code>switchTo</code> moves the handle to the object and then keeps it <b>attached</b>: when the object moves, the handle moves along. This is the counterpart to <code>PantoHandle.SwitchTo</code> in the Unity toolkit and the way to make an enemy tangible – the person feels it through the It handle.</p>
  ${code(`const enemy = level.entity("Guard");
enemy.patrol([[150, 80], [210, 140]], { speed: 60 });

await it.switchTo(enemy);               // moves there, resolves on arrival
it.isFollowing   it.followName          // true, "Guard"
it.stopFollow();                        // stays where it is
it.free();                              // let go (also stops following)

it.switchTo(level.zone("Goal"));                       // centre of the zone
it.switchTo(() => ({ x: 200, y: 110 + panto.time }));  // your own curve
me.switchTo(enemy);                                    // guides the person's hand`)}
  <p>On the device this is about 17 packets per second while the target moves – the Unity toolkit sends 50. If the object stands still, nothing is sent. If the target leaves the handle's reachable area, the handle stays at the nearest reachable point and the console says so once.</p>
  <h4>If the handle moves unevenly</h4>
  <p>The firmware moves the god object to the target in <code>1 / SPEED</code> seconds. If a move lasts only one update interval, it is over before the next target arrives – the handle moves in small bursts and pulses at the update rate. So by default every move lasts <b>2.5 intervals</b> (<code>ease</code>) and the moves overlap; a <b>lead</b> (<code>lead</code>) compensates the lag, and a noisy target is <b>smoothed</b> (<code>smooth</code>).</p>
  ${code(`it.switchTo(enemy, {
  speed: 150,     // upper limit mm/s – for the approach and for jumps
  hz: 20,         // updates per second
  ease: 2.5,      // move duration in intervals: larger = calmer, more sluggish
  smooth: 0.25,   // smoothing of the target (with a handle as target: 0.6)
  lead: 0.6,      // lead against the lag
  deadzone: 1,    // only send once the target has moved 1 mm
});`)}
  <p>Still twitching: raise <code>ease</code> to 3–4 and lower <code>hz</code> to 12–15. Handle lagging too far behind: lower <code>ease</code> (not below 1.5) or set <code>lead</code> to 1. Target jittering (the person's hand, sensor values): set <code>smooth</code> to 0.6–0.8.</p>
  <p><code>entity.attachTo("it")</code> is shorthand for <code>it.switchTo(entity)</code>.</p>
</section>
<section>
  <h3>Levels</h3>
  ${code(`panto.onLevel("Hallway", (level) => {
  level.zone("Exit").onEnter(() => panto.loadLevel("Rail"));
});
panto.loadLevel("Hallway");   panto.nextLevel();
panto.level.name              panto.levels   // all names
state.score = 0               // survives level changes`)}
  <p>Zones with a text under "Say on enter" speak automatically.</p>
</section>
<section>
  <h3>Objects in code – at any time while running</h3>
  <p>The level editor is just a shortcut. <b>Everything</b> can be created, changed and removed in the script – on start, in a timer, in <code>onFrame</code>, in response to a zone, a key or a voice command. Whatever you create goes to the device (or emulator) immediately and shows up in the preview.</p>
  ${code(`const door = panto.wall([[150, 60], [150, 140]], { name: "Door" });
panto.box(200, 95, 30, 25, { name: "Box" });
panto.circle(260, 120, 18);
panto.rail([[140, 160], [280, 160]], { strength: 8 });
const z = panto.zone({ x: 250, y: 60, r: 16 }, { name: "Goal", speak: "At the goal" });
const enemy = panto.enemy(170, 100, { name: "Foe" });
const coin = panto.item(230, 140, { name: "Coin" });

door.disable();   door.enable();   door.remove();     // at any time
after(2000, () => panto.box(120, 100, 20, 20));       // add more later
onKey("n", () => panto.circle(randomPoint(20).x, randomPoint(20).y, 12));
z.onEnter(() => panto.enemy(randomPoint(20), { name: "Reinforcement" }));`)}
  <p><b>Finding objects again:</b> by name, whether drawn or created in code.</p>
  ${code(`level.object("Door");  level.zone("Goal");  level.entity("Foe");
level.items();  level.enemies();  level.zones();
panto.find("Foe");         // also works in the main script, where there is no "level"
panto.objects("wall");     // all walls of the scene`)}
  <p><b>Cleanup</b> happens automatically and depends on <i>where</i> something is created: in a <b>level script</b> it belongs to the level and disappears when the level changes; in the <b>main script</b> it stays across levels. <code>{ persistent: true }</code> makes an object from a level script permanent too. On stop, everything is removed.</p>
  <p><code>handles: "me"</code> or <code>"it"</code> makes an obstacle apply to one handle only.</p>
  <p><b>On the real device, every obstacle costs packets:</b> a wall is one CREATE, one packet per point and one ENABLE, with 10&nbsp;ms between two such packets. A line with 2 points takes about 40&nbsp;ms, a <code>panto.circle</code> with 16 corners almost 200&nbsp;ms. For something that changes often it is better to <b>create obstacles once and just enable and disable them</b> (one packet each) instead of creating them over and over. Zones and entities cost nothing – the Studio computes them itself.</p>
</section>
<section>
  <h3>Enemies, items &amp; custom objects</h3>
  <p>An <b>entity</b> is a visible object in the scene: an enemy (red triangle), an item (green diamond) or a marker. Entities are <b>not</b> attached to the device – they are drawn in the level editor and the preview and react when the Me handle comes within their radius. That is enough for games with sound and speech output.</p>
  <p>In the level editor you place them with the <b>Enemy</b> (E) and <b>Item</b> (I) tools and give them a name. In the script you get them by that name:</p>
  ${code(`const enemy = level.entity("Enemy 1");
enemy.patrol([[140, 80], [260, 80]], { speed: 40 });   // back and forth
enemy.onTouch(() => speak("Caught!"));

level.entity("Item 1").onCollect(() => {
  state.score = (state.score ?? 0) + 1;
  speak(\`\${state.score} of \${level.items().length}\`);
});

level.items()      // all items   level.enemies()   level.entities()`)}
  <p>You can just as well create them in code – then you don't need the editor at all:</p>
  ${code(`const coin = panto.item(200, 80, { name: "Coin", r: 12, speak: "Coin!" });
const hunter = panto.enemy(140, 70, { r: 14 });
hunter.follow(me, { speed: 30 });          // chases the Me handle
const goal = panto.entity({ x: 270, y: 150, name: "Goal" });

await coin.moveTo({ x: 160, y: 150 }, { speed: 80 });
coin.moveToNow(randomPoint(15));           // without animation
coin.collect();  coin.reset();             // collect / bring back
hunter.halt();  hunter.hide();  hunter.remove();
coin.position   coin.radius = 16   coin.distanceTo(me)   coin.touching()`)}
  <p><b>Making them tangible</b> – two ways, both optional:</p>
  <ul>
    <li><code>solid: true</code> (or <code>setSolid()</code>) creates a round wall. On the device, the runtime only re-sends moving objects when they stop – sending an obstacle again costs packets.</li>
    <li><code>attachTo("it")</code> keeps sending the It handle to the object. That way the person can feel it directly, e.g. the enemy chasing them.</li>
  </ul>
  ${code(`panto.enemy(150, 90, { name: "Guard", solid: true });
level.entity("Guard").attachTo("it");   // It moves along
level.entity("Guard").detach();`)}
  <p>Without a single line of code: an item disappears and beeps when touched, an enemy buzzes. A text under "Say on touch" is spoken, a selected sound is played.</p>
</section>
<section>
  <h3>Levels in code</h3>
  <p>If you prefer programming, you can build levels entirely in the script – randomly generated, from data, or as many as you like in a row. <code>panto.defineLevel</code> registers such a level under a name; after that, <code>panto.loadLevel</code> works as with drawn levels.</p>
  ${code(`panto.defineLevel("Arena", (level) => {
  panto.box(170, 95, 35, 28, { name: "Box" });
  for (let i = 0; i < 5; i++) panto.item(randomPoint(20), { name: "Coin " + i });
  const hunter = panto.enemy(randomPoint(20), { name: "Hunter", r: 14 });
  hunter.follow(me, { speed: 25 });
  hunter.onTouch(() => panto.loadLevel("Arena"));   // try again

  panto.onFrame((dt) => {                           // your own game logic
    if (!level.items().some((it) => it.isVisible)) speak("All collected!");
  });
}, { spawn: { me: { x: 130, y: 80 } }, intro: "Arena. Collect the coins." });

panto.loadLevel("Arena");
panto.time        // seconds since start`)}
  <p><code>panto.onFrame(fn)</code> runs about 60 times per second; <code>dt</code> is the time since the last frame in seconds – good for your own movements, timers and collisions. Everything created in the builder is cleaned up by the runtime when the level changes.</p>
</section>
<section>
  <h3>Output &amp; input</h3>
  ${code(`await speak("Hello");   speak("Right now", { interrupt: true });
sound.beep(440, 150);   sound.tick();   sound.success();
onKey("Enter", () => …);  onKey("Space", …);  onKey("n", …)
listen(["start", "stop"], (cmd) => …)    // voice input
const name = await ui.prompt("What's your name?");`)}
</section>
<section>
  <h3>Voice input</h3>
  <p>The microphone is available in Chrome and Edge on desktop – the same browsers as Web Serial. The top right shows whether the program is listening; clicking it turns it on and off. The first time, the browser asks for permission. Recognition uses the project language (<code>en-US</code> for new projects).</p>
  <p>Interpretation uses <b>patterns</b>, not a language model. Placeholders <code>{name}</code> extract parts of the sentence, <code>{name:number}</code> turns them into a number (<code>"twenty-three"</code> → <code>23</code>), round brackets allow alternatives. Filler words, word endings ("starting" instead of "start") and umlaut spellings are tolerated.</p>
  ${code(`voice.command("(start|begin|go) game", () => panto.loadLevel("Arena"));
voice.command("go to {target}", ({ target }) => speak("Looking for " + target));
voice.command("set score {n:number}", ({ n }) => state.score = n);
voice.command("*", ({ text }) => log("not understood: " + text));   // catch-all

voice.onText((text) => log("heard: " + text));       // every sentence
voice.onPartial((text) => …);                        // already while speaking
voice.lastText     voice.isListening     voice.state`)}
  <p><b>Asking questions</b> – better than <code>ui.prompt</code> when nobody sees the keyboard. The question is spoken, then the program listens; with no answer you get <code>null</code>.</p>
  ${code(`const text  = await voice.ask("What is the task called?");
const score = await voice.ask("How many points?", { expect: "number" });
const color = await voice.ask("Which colour?", { expect: ["red", "green", "blue"] });
if (await voice.confirm("Really delete?")) …
const any   = await ui.askVoice("Name?");   // voice, otherwise keyboard`)}
  <p><b>Two pitfalls</b> we handle for you:</p>
  <ul>
    <li><b>The program speaks itself.</b> The microphone hears <code>speak()</code>. Results that arrive during or up to <code>voice.echoWindow</code> ms after the program's own output and resemble it are dropped (visible in the device log). The safest option is <b>push-to-talk</b>: <code>voice.pushToTalk("v")</code> – hold the key and speak.</li>
    <li><b>In Chrome, recognition runs on a server</b>, so the audio goes over the network and nothing works offline. <code>voice.localAvailable()</code> tells you whether this browser can recognise on the device; <code>voice.installLocal()</code> downloads the language pack, after which <code>voice.start({ local: true })</code> keeps everything on the computer. On start, the console says what applies here.</li>
  </ul>
  <p>Helpers outside of patterns: <code>parseNumber("twenty-five")</code>, <code>matchText(text, ["yes", "no"])</code>, <code>normalizeText(text)</code>. The old, simple form <code>listen(["start", "stop"], fn)</code> keeps working.</p>
</section>
<section>
  <h3>Sounds</h3>
  <p>In the sidebar under "Sounds" you upload MP3 or WAV files (or drag them in). In the script you refer to them by file name. Clicking a name in the list inserts the matching line into the open script.</p>
  ${code(`sound.play("hit.wav");
const music = sound.play("background.mp3", { volume: 0.3, loop: true });
music.stop();
await sound.play("gong.wav").ended;     // wait until the sound is over
await sound.preload("hit.wav");         // load in advance, then no delay
sound.stopAll();   sound.names          // all uploaded file names`)}
  <p>The files are stored in the browser (IndexedDB), not on a server. When you export the project they are included in the project file; on stop, playing sounds are ended.</p>
</section>
<section>
  <h3>Time</h3>
  ${code(`after(1000, () => speak("One second later"));
const stop = every(500, () => …);  stop();
await wait(2000);`)}
</section>
<section>
  <h3>Apps: menus &amp; lists</h3>
  ${code(`const menu = ui.menu(["New", "Open", "Quit"], {
  title: "Main menu", y: 40, spacing: 30,
  onSelect: (item, i) => speak(item + " selected"),
});
menu.setItems([...]);   menu.focused   menu.remove();
storage.set("notes", list);   storage.get("notes", [])`)}
  <p>The menu creates a rail on which every item snaps in and is announced. Enter or Space selects.</p>
</section>
<section>
  <h3>Emulator</h3>
  <p>Without a device: drag <b>Me</b> with the mouse, <b>It</b> with Shift&nbsp;+&nbsp;drag or the right mouse button. The filled circle is the "god object" (what the person feels), the dashed circle is the actual handle position.</p>
</section>
`;
