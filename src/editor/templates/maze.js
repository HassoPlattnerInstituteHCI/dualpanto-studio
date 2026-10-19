import { oid } from './utils.js';

export default {
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
};
