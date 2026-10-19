import { oid } from './utils.js';

export default {
  key: 'empty',
  title: 'Empty project',
  description: 'An empty level and an empty script.',
  project: () => ({
    name: 'New project',
    script: `// Your program. Press ▶ Run to try it.
// The API reference is in the "API" tab on the right.

speak("Let's go!");
`,
    levels: [
      {
        id: oid(),
        name: 'Level 1',
        intro: '',
        spawn: {},
        objects: [],
        script: `// Script for this level. "level" is the loaded level.
// Example: level.zone("Goal").onEnter(() => speak("Done!"));
`,
      },
    ],
  }),
};
