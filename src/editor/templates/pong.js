import { oid } from './utils.js';

export default {
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
};
