import { rect, oid } from './utils.js';

export default {
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
};
