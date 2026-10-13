// Starter projects. Coordinates are millimetres on the working area
// (360 × 210 mm, origin top-left, y downwards).

const rect = (x, y, w, h) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

let n = 0;
const oid = () => 'o' + ++n;

export const TEMPLATES = [
  {
    key: 'hello',
    title: 'Hello Panto',
    description: 'One level with a box and a goal. The simplest way to start.',
    project: () => ({
      name: 'Hello Panto',
      script: `// Welcome! This script runs as soon as you press ▶ Run.
// me = the handle the person moves. it = the handle the program moves.
// In the emulator: drag Me with the left mouse button, It with Shift + drag.

// The dashed outlines show where the handles can reach (orange = Me, purple = It).
// The "Boundary" switch at the top turns the edge of the Me area into a wall.
// Upload sounds on the left and play them with sound.play("name.wav").

speak("Hello! There is a box in the middle. Find the goal at the bottom right.");

// Space: announce the position – works in every level
onKey("Space", () => {
  speak(\`You are at x \${Math.round(me.x)}, y \${Math.round(me.y)} millimetres.\`);
});
`,
      levels: [
        {
          id: oid(),
          name: 'Start',
          intro: '',
          script: `// This script belongs to the level "Start".

level.zone("Goal").onEnter(async () => {
  await sound.success();
  // It comes to you – but only if it can reach you there
  if (it.canReach(me)) it.moveTo(me.position);
  else speak("Unfortunately It can't get there.");
});
`,
          spawn: { me: { x: 130, y: 80 }, it: { x: 200, y: 125 } },
          objects: [
            { id: oid(), type: 'wall', name: 'Box', points: rect(170, 95, 35, 28), closed: true },
            { id: oid(), type: 'zone', name: 'Goal', shape: 'circle', x: 268, y: 140, r: 14, speak: 'You found the goal!' },
          ],
        },
      ],
    }),
  },
  {
    key: 'maze',
    title: 'Maze (2 levels)',
    description: 'Two levels: a hallway with walls, then a rail. Shows how to switch levels.',
    project: () => ({
      name: 'Maze',
      script: `// Main script: intro, score and level control.
// What happens inside a single level is in that level's script.

state.start = Date.now();

// R = start over
onKey("r", () => {
  state.start = Date.now();
  panto.loadLevel("Hallway");
});

panto.onLevel((level) => log("Level started: " + level.name));
`,
      levels: [
        {
          id: oid(),
          name: 'Hallway',
          intro: 'Level 1. Find the exit at the bottom right.',
          script: `level.zone("Exit").onEnter(async () => {
  await sound.success();
  panto.loadLevel("Rail");   // or panto.nextLevel()
});
`,
          spawn: { me: { x: 110, y: 75 } },
          objects: [
            // the walls stick out over the edge of the Me area, so you can't go around them
            { id: oid(), type: 'wall', name: '', points: [{ x: 150, y: 20 }, { x: 150, y: 120 }], closed: false },
            { id: oid(), type: 'wall', name: '', points: [{ x: 215, y: 95 }, { x: 215, y: 195 }], closed: false },
            { id: oid(), type: 'zone', name: 'Exit', shape: 'circle', x: 272, y: 145, r: 13, speak: '' },
          ],
        },
        {
          id: oid(),
          name: 'Rail',
          intro: 'Level 2. Follow the rail to the goal.',
          script: `level.zone("Goal").onEnter(() => {
  const seconds = Math.round((Date.now() - state.start) / 1000);
  speak(\`Done! You took \${seconds} seconds.\`);
});
`,
          spawn: { me: { x: 110, y: 75 } },
          objects: [
            {
              id: oid(), type: 'rail', name: 'Path', strength: 8,
              points: [{ x: 110, y: 75 }, { x: 190, y: 75 }, { x: 190, y: 140 }, { x: 268, y: 140 }],
            },
            { id: oid(), type: 'zone', name: 'Goal', shape: 'circle', x: 268, y: 140, r: 14, speak: '' },
          ],
        },
      ],
    }),
  },
  {
    key: 'todo',
    title: 'To-do list (productivity)',
    description: 'A haptic list with ui.menu: feel the tasks, tick them off, add new ones. Saves in the browser.',
    project: () => ({
      name: 'To-do list',
      script: `// Productivity app: a to-do list you explore with the Me handle.
// Enter/Space = tick off   N = new task   Delete = remove   L = read everything

let todos = storage.get("todos", [
  { text: "Prepare slides", done: false },
  { text: "Email supervisor", done: true },
  { text: "Calibrate DualPanto", done: false },
]);

const label = (t) => (t.done ? "done: " : "") + t.text;

// By default the menu sits in the middle of the Me area (x 190, from y 55, one item every 25 mm).
const list = ui.menu(todos.map(label), {
  title: \`Your tasks. \${todos.length} items.\`,
  onSelect: (item, i) => {
    todos[i].done = !todos[i].done;
    save();
    speak(todos[i].done ? "Done" : "Open again", { interrupt: true });
  },
});

function save() {
  storage.set("todos", todos);
  list.setItems(todos.map(label));
}

onKey("n", async () => {
  const text = await ui.prompt("New task?");
  if (!text) return;
  todos.push({ text, done: false });
  save();
  speak("Added: " + text);
});

onKey("Delete", () => {
  const i = list.focused;
  if (i < 0 || !todos[i]) return;
  const [removed] = todos.splice(i, 1);
  save();
  speak("Deleted: " + removed.text, { interrupt: true });
});

onKey("l", async () => {
  const open = todos.filter((t) => !t.done);
  await speak(\`\${open.length} open tasks.\`, { interrupt: true });
  for (const t of open) await speak(t.text);
});
`,
      levels: [],
    }),
  },
  {
    key: 'tag',
    title: 'Tag (It moves)',
    description: 'It hides in random places, a tone tells you the distance. Shows it.moveTo and every().',
    project: () => ({
      name: 'Tag',
      script: `// Main script: greeting and score.
state.score = 0;
speak("Tag! It is hiding. The closer you get, the higher the tone.");
`,
      levels: [
        {
          id: oid(),
          name: 'Field',
          intro: '',
          script: `// Game logic for the level "Field".

// randomPoint(margin) returns a point that both Me AND It can reach
async function hide() {
  await it.moveTo(randomPoint(15), { speed: 150 });
}

await hide();

every(400, () => {
  if (it.isMoving) return;
  const d = me.distanceTo(it);
  sound.beep(1000 - Math.min(800, d * 4), 60);
  if (d < 15) {
    state.score++;
    speak(\`Caught! \${state.score} points.\`, { interrupt: true });
    hide();
  }
});
`,
          spawn: { me: { x: 230, y: 125 } },
          objects: [],
        },
      ],
    }),
  },
  {
    key: 'voice',
    title: 'Voice notes (voice input)',
    description: 'A task list you explore by touch and control by voice. Shows voice.command, voice.ask and ui.menu.',
    project: () => ({
      name: 'Voice notes',
      script: `// A productivity app that works without a keyboard: explore with the Me handle,
// control it with your voice. The microphone pill at the top right shows whether it is listening.
//
// Voice commands:
//   "new task"         asks for the text and adds it
//   "task three"       selects the third item and moves the handle there
//   "done"             ticks off the selected item
//   "read out"         reads all open tasks
//   "delete"           deletes the selected item (asks first)
//
// Always listening is convenient but also picks up side conversations. Alternative:
// voice.pushToTalk("v")  → hold the key and speak.

const X = 190, Y = 55, SPACING = 25;

let todos = storage.get("todos", [
  { text: "Prepare slides", done: false },
  { text: "Email supervisor", done: true },
  { text: "Calibrate DualPanto", done: false },
]);

const label = (t) => (t.done ? "done: " : "") + t.text;

const list = ui.menu(todos.map(label), {
  x: X, y: Y, spacing: SPACING,
  title: \`Your tasks. \${todos.length} items. Say "new task" or "read out".\`,
  onSelect: (item, i) => toggle(i),
});

function save() {
  storage.set("todos", todos);
  list.setItems(todos.map(label));
}

function toggle(i) {
  if (!todos[i]) return;
  todos[i].done = !todos[i].done;
  save();
  speak(todos[i].done ? "Done" : "Open again", { interrupt: true });
}

// --- voice commands --------------------------------------------------------

voice.command("(new|add) task", async () => {
  const text = await voice.ask("What is the task called?");
  if (!text) return speak("Nothing added.");
  if (!(await voice.confirm(\`\${text}. Shall I add it like that?\`))) return speak("Discarded.");
  todos.push({ text, done: false });
  save();
  speak("Added: " + text);
});

// {n:number} understands "three" just as well as "3"
voice.command("task {n:number}", async ({ n }) => {
  const i = n - 1;
  if (!todos[i]) return speak(\`There are only \${todos.length} tasks.\`, { interrupt: true });
  list.focused = i;
  speak(label(todos[i]), { interrupt: true });
  await me.moveTo({ x: X, y: Y + i * SPACING });
});

voice.command("(done|check|finished)", () => toggle(list.focused));

voice.command("(read out|read aloud|what is open)", async () => {
  const open = todos.filter((t) => !t.done);
  await speak(\`\${open.length} open tasks.\`, { interrupt: true });
  for (const t of open) await speak(t.text);
});

voice.command("(delete|remove)", async () => {
  const i = list.focused;
  if (!todos[i]) return speak("Nothing selected. Say for example: task one.");
  if (!(await voice.confirm(\`Really delete \${todos[i].text}?\`))) return speak("Kept.");
  const [removed] = todos.splice(i, 1);
  save();
  speak("Deleted: " + removed.text, { interrupt: true });
});

// Anything that matches no command ends up here – handy for debugging.
voice.command("*", ({ text }) => log("not understood: " + text));

onKey("m", () => (voice.isListening ? voice.stop() : voice.start()));
`,
      levels: [],
    }),
  },
  {
    key: 'collect',
    title: 'Collect (enemies & items)',
    description: 'Collect three items while avoiding an enemy. Shows level.entity, patrol, follow and onFrame.',
    project: () => ({
      name: 'Collect',
      script: `// Main script: score and greeting.
// You place enemies and items in the level editor (tools "Enemy" and "Item").
// They are shown and react to touch – they are not attached to the device.

state.score = 0;
speak("Collect the three items. The enemy walks back and forth – avoid it.");
`,
      levels: [
        {
          id: oid(),
          name: 'Hall',
          intro: '',
          script: `// Level script: here the objects from the editor get their behaviour.

const guard = level.entity("Guard");
guard.patrol([{ x: 140, y: 80 }, { x: 230, y: 80 }], { speed: 45 });

// The It handle is attached to the enemy, so the person can feel it while it walks.
// (it.stopFollow() or it.free() ends this again.)
it.switchTo(guard, { speed: 150 });
guard.onTouch(async () => {
  await speak("Caught! Start over.", { interrupt: true });
  panto.loadLevel("Hall");
});

// all items of the level: count them when collected
for (const item of level.items()) {
  item.onCollect(() => {
    state.score++;
    speak(\`\${state.score} of \${level.items().length}\`, { interrupt: true });
    if (level.items().every((i) => !i.isVisible)) {
      sound.success();
      speak("All collected!");
    }
  });
}

// distance to the enemy as a tone – onFrame runs every frame
let lastBeep = 0;
panto.onFrame((dt, time) => {
  const d = guard.distanceTo(me);
  if (d > 60 || time - lastBeep < 0.35) return;
  lastBeep = time;
  sound.beep(1200 - d * 10, 40, { volume: 0.12 });
});
`,
          spawn: { me: { x: 150, y: 120 } },
          objects: [
            { id: oid(), type: 'wall', name: 'Box', points: rect(195, 100, 30, 24), closed: true },
            { id: oid(), type: 'entity', kind: 'enemy', name: 'Guard', shape: 'circle', x: 140, y: 80, r: 13, speak: '', sound: '', solid: false, handle: 'me' },
            { id: oid(), type: 'entity', kind: 'item', name: 'Item 1', shape: 'circle', x: 160, y: 152, r: 11, speak: '', sound: '', solid: false, handle: 'me' },
            { id: oid(), type: 'entity', kind: 'item', name: 'Item 2', shape: 'circle', x: 240, y: 145, r: 11, speak: '', sound: '', solid: false, handle: 'me' },
            { id: oid(), type: 'entity', kind: 'item', name: 'Item 3', shape: 'circle', x: 265, y: 95, r: 11, speak: '', sound: '', solid: false, handle: 'me' },
          ],
        },
      ],
    }),
  },
  {
    key: 'pong',
    title: 'Pong (It is the opponent)',
    description: 'Ping-pong against the computer. The opponent follows the ball at a fixed speed, the It handle is attached to the opponent.',
    project: () => ({
      name: 'Pong',
      script: `// Main script: score and greeting.
// Your paddle is the Me handle; it runs along the rail at the bottom.
// The opponent at the top follows the ball – the It handle is attached to it, so you feel where it is.

state.me = 0;
state.opponent = 0;
speak("Pong! Your paddle is at the bottom. The higher the tone, the further right the ball is. A clear tone means the ball is above your paddle.");

onKey("Space", () => speak(\`\${state.me} to \${state.opponent}\`, { interrupt: true }));
`,
      levels: [
        {
          id: oid(),
          name: 'Field',
          intro: '',
          script: `// Level script: ball, paddle and opponent.
//
// Field coordinates in mm: (0, 0) is the top middle of the DualPanto area,
// x to the right (negative = left), y downwards. The API works in world coordinates
// (origin top left), so world() and field() convert where the two meet.
// The field lies where both Me and It can reach (x −50…50, y 70…140).

const CENTER = 180;                                   // x of the centre in world coordinates
const world = (x, y) => ({ x: x + CENTER, y });       // field → world
const field = (p) => ({ x: p.x - CENTER, y: p.y });   // world → field (handle, object, point)

const LEFT = -50, RIGHT = 50;
const OPPONENT_Y = 78;        // line of the opponent (top)
const PLAYER_Y = 132;         // line of your paddle (bottom, = rail)
const PADDLE = 16;            // half paddle width in mm
const OPPONENT_SPEED = 45;    // how fast (mm/s) the opponent follows the ball – lower = easier
const BALL_SPEED = 60;        // starting speed of the ball in mm/s
const SPEEDUP = 1.06;         // the ball gets this much faster after every hit

const ball = level.entity("Ball");
const opponent = level.entity("Opponent");

// ball position in field coordinates
let bx = 0, by = 0;
let vx = 0, vy = 0;
let pause = 0;                // seconds until the next serve

// The opponent follows the ball but stays on its line:
// follow() gets a target whose position is recomputed every frame.
opponent.follow({ get position() { return world(bx, OPPONENT_Y); } }, { speed: OPPONENT_SPEED });

// The It handle is attached to the opponent – the person feels where it is.
it.switchTo(opponent, { speed: 150 });

function serve(direction) {
  bx = 0;
  by = (OPPONENT_Y + PLAYER_Y) / 2;
  ball.position = world(bx, by);
  const angle = (Math.random() - 0.5) * 1.2;           // up to about ±35°
  vx = Math.sin(angle) * BALL_SPEED;
  vy = Math.cos(angle) * BALL_SPEED * direction;       // +1 = towards you, -1 = towards the opponent
  pause = 1.5;
}

// Where the ball hits the paddle decides the bounce angle.
function bounce(paddleX, direction) {
  const speed = Math.hypot(vx, vy) * SPEEDUP;
  const offset = Math.max(-1, Math.min(1, (bx - paddleX) / PADDLE));
  const angle = offset * 1.0;                          // up to about ±57°
  vx = Math.sin(angle) * speed;
  vy = Math.cos(angle) * speed * direction;
}

function point(forMe) {
  if (forMe) state.me++; else state.opponent++;
  sound.beep(forMe ? 880 : 220, 300);
  speak(\`\${forMe ? "Your point" : "Point for the opponent"}. \${state.me} to \${state.opponent}.\`, { interrupt: true });
  serve(forMe ? -1 : 1);                               // whoever loses the point gets the ball
}

serve(1);

let lastBeep = 0;
panto.onFrame((dt, time) => {
  if (pause > 0) { pause -= dt; return; }

  const mine = field(me);
  const theirs = field(opponent);
  bx += vx * dt;
  by += vy * dt;

  // side walls
  if (bx < LEFT)  { bx = 2 * LEFT - bx;  vx = -vx; sound.tick(); }
  if (bx > RIGHT) { bx = 2 * RIGHT - bx; vx = -vx; sound.tick(); }

  // bottom: your paddle (Me)
  if (vy > 0 && by >= PLAYER_Y) {
    if (Math.abs(bx - mine.x) <= PADDLE) {
      by = PLAYER_Y; bounce(mine.x, -1); sound.beep(660, 60);
    } else {
      return point(false);
    }
  }
  // top: the opponent (It)
  if (vy < 0 && by <= OPPONENT_Y) {
    if (Math.abs(bx - theirs.x) <= PADDLE) {
      by = OPPONENT_Y; bounce(theirs.x, 1); sound.beep(440, 60);
    } else {
      return point(true);
    }
  }

  ball.position = world(bx, by);

  // Make the ball audible: pitch = left/right; when it comes towards you, it beeps faster.
  const progress = (by - OPPONENT_Y) / (PLAYER_Y - OPPONENT_Y);     // 0 = top, 1 = bottom
  const interval = vy > 0 ? 0.35 - progress * 0.25 : 0.4;
  if (time - lastBeep < interval) return;
  lastBeep = time;
  const aboveMe = Math.abs(bx - mine.x) <= PADDLE;
  sound.beep(600 + bx * 6, 40, { volume: 0.15, type: aboveMe ? "sine" : "triangle" });
});
`,
          spawn: { me: { x: 180, y: 132 }, it: { x: 180, y: 78 } },
          objects: [
            // side walls: Me feels the edges of the field
            { id: oid(), type: 'wall', name: 'Left wall', points: [{ x: 126, y: 65 }, { x: 126, y: 145 }], closed: false },
            { id: oid(), type: 'wall', name: 'Right wall', points: [{ x: 234, y: 65 }, { x: 234, y: 145 }], closed: false },
            // rail for your paddle, Me only
            { id: oid(), type: 'rail', name: 'Paddle track', strength: 6, handles: 'me', points: [{ x: 130, y: 132 }, { x: 230, y: 132 }] },
            { id: oid(), type: 'entity', kind: 'enemy', name: 'Opponent', shape: 'circle', x: 180, y: 78, r: 8, speak: '', sound: '', solid: false, handle: 'me' },
            { id: oid(), type: 'entity', kind: 'marker', name: 'Ball', shape: 'circle', x: 180, y: 105, r: 4, speak: '', sound: '', solid: false, handle: 'me' },
          ],
        },
      ],
    }),
  },
  {
    key: 'empty',
    title: 'Empty project',
    description: 'An empty level and an empty script.',
    project: () => ({
      name: 'New project',
      script: `// Your program. Press ▶ Run to try it.
// The API reference is in the "API" tab on the right.

speak("Let's go!");
`,
      levels: [{
        id: oid(), name: 'Level 1', intro: '', spawn: {}, objects: [],
        script: `// Script for this level. "level" is the loaded level.
// Example: level.zone("Goal").onEnter(() => speak("Done!"));
`,
      }],
    }),
  },
];
