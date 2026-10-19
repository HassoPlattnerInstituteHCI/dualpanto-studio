import { rect, oid } from './utils.js';

export default {
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
};
