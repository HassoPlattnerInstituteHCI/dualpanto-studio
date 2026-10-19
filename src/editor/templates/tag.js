import { oid } from './utils.js';

export default {
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
};
