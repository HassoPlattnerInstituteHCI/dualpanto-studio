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
    title: 'Hallo Panto',
    description: 'Ein Level mit einer Kiste und einem Ziel. Der einfachste Einstieg.',
    project: () => ({
      name: 'Hallo Panto',
      script: `// Willkommen! Dieses Skript läuft, sobald du auf ▶ Start drückst.
// me = der Griff, den die Person bewegt. it = der Griff, den das Programm bewegt.
// Im Emulator: Me mit der linken Maustaste ziehen, It mit Shift + Ziehen.

// Gestrichelt siehst du, wohin die Griffe reichen (orange = Me, lila = It).
// Mit dem Schalter "Rand" oben wird der Rand des Me-Bereichs zu einer Wand.
// Sounds lädst du links hoch und spielst sie mit sound.play("name.wav") ab.

speak("Hallo! In der Mitte steht eine Kiste. Finde das Ziel unten rechts.");

// Leertaste: Position ansagen – gilt in allen Leveln
onKey("Space", () => {
  speak(\`Du bist bei x \${Math.round(me.x)}, y \${Math.round(me.y)} Millimeter.\`);
});
`,
      levels: [
        {
          id: oid(),
          name: 'Start',
          intro: '',
          script: `// Dieses Skript gehört zum Level "Start".

level.zone("Ziel").onEnter(async () => {
  await sound.success();
  // It kommt zu dir – aber nur, wenn es dort hinreicht
  if (it.canReach(me)) it.moveTo(me.position);
  else speak("It kommt hier leider nicht hin.");
});
`,
          spawn: { me: { x: 130, y: 80 }, it: { x: 200, y: 125 } },
          objects: [
            { id: oid(), type: 'wall', name: 'Kiste', points: rect(170, 95, 35, 28), closed: true },
            { id: oid(), type: 'zone', name: 'Ziel', shape: 'circle', x: 268, y: 140, r: 14, speak: 'Du hast das Ziel gefunden!' },
          ],
        },
      ],
    }),
  },
  {
    key: 'maze',
    title: 'Labyrinth (2 Level)',
    description: 'Zwei Level: ein Gang mit Wänden, danach eine Schiene (Hallway). Zeigt Level-Wechsel.',
    project: () => ({
      name: 'Labyrinth',
      script: `// Haupt-Skript: Intro, Spielstand und Level-Steuerung.
// Was in einem einzelnen Level passiert, steht im Skript des Levels.

state.start = Date.now();

// R = von vorn beginnen
onKey("r", () => {
  state.start = Date.now();
  panto.loadLevel("Gang");
});

panto.onLevel((level) => log("Level gestartet: " + level.name));
`,
      levels: [
        {
          id: oid(),
          name: 'Gang',
          intro: 'Level 1. Finde den Ausgang unten rechts.',
          script: `level.zone("Ausgang").onEnter(async () => {
  await sound.success();
  panto.loadLevel("Schiene");   // oder panto.nextLevel()
});
`,
          spawn: { me: { x: 110, y: 75 } },
          objects: [
            // die Wände ragen über den Rand des Me-Bereichs hinaus, damit man nicht außen herum kommt
            { id: oid(), type: 'wall', name: '', points: [{ x: 150, y: 20 }, { x: 150, y: 120 }], closed: false },
            { id: oid(), type: 'wall', name: '', points: [{ x: 215, y: 95 }, { x: 215, y: 195 }], closed: false },
            { id: oid(), type: 'zone', name: 'Ausgang', shape: 'circle', x: 272, y: 145, r: 13, speak: '' },
          ],
        },
        {
          id: oid(),
          name: 'Schiene',
          intro: 'Level 2. Folge der Schiene bis zum Ziel.',
          script: `level.zone("Ziel").onEnter(() => {
  const sekunden = Math.round((Date.now() - state.start) / 1000);
  speak(\`Geschafft! Du hast \${sekunden} Sekunden gebraucht.\`);
});
`,
          spawn: { me: { x: 110, y: 75 } },
          objects: [
            {
              id: oid(), type: 'rail', name: 'Weg', strength: 8,
              points: [{ x: 110, y: 75 }, { x: 190, y: 75 }, { x: 190, y: 140 }, { x: 268, y: 140 }],
            },
            { id: oid(), type: 'zone', name: 'Ziel', shape: 'circle', x: 268, y: 140, r: 14, speak: '' },
          ],
        },
      ],
    }),
  },
  {
    key: 'todo',
    title: 'To-do-Liste (Produktivität)',
    description: 'Eine haptische Liste mit ui.menu: Aufgaben abtasten, abhaken, hinzufügen. Speichert im Browser.',
    project: () => ({
      name: 'To-do-Liste',
      script: `// Produktivitäts-App: eine To-do-Liste, die man mit dem Me-Griff abtastet.
// Enter/Leertaste = abhaken   N = neue Aufgabe   Entf = löschen   L = alles vorlesen

let todos = storage.get("todos", [
  { text: "Folien vorbereiten", done: false },
  { text: "Mail an Betreuer", done: true },
  { text: "DualPanto kalibrieren", done: false },
]);

const label = (t) => (t.done ? "erledigt: " : "") + t.text;

// Das Menü liegt standardmäßig mitten im Me-Bereich (x 190, ab y 55, alle 25 mm ein Eintrag).
const liste = ui.menu(todos.map(label), {
  title: \`Deine Aufgaben. \${todos.length} Einträge.\`,
  onSelect: (item, i) => {
    todos[i].done = !todos[i].done;
    speichern();
    speak(todos[i].done ? "Erledigt" : "Wieder offen", { interrupt: true });
  },
});

function speichern() {
  storage.set("todos", todos);
  liste.setItems(todos.map(label));
}

onKey("n", async () => {
  const text = await ui.prompt("Neue Aufgabe?");
  if (!text) return;
  todos.push({ text, done: false });
  speichern();
  speak("Hinzugefügt: " + text);
});

onKey("Delete", () => {
  const i = liste.focused;
  if (i < 0 || !todos[i]) return;
  const [weg] = todos.splice(i, 1);
  speichern();
  speak("Gelöscht: " + weg.text, { interrupt: true });
});

onKey("l", async () => {
  const offen = todos.filter((t) => !t.done);
  await speak(\`\${offen.length} offene Aufgaben.\`, { interrupt: true });
  for (const t of offen) await speak(t.text);
});
`,
      levels: [],
    }),
  },
  {
    key: 'tag',
    title: 'Fangen (It bewegt sich)',
    description: 'It versteckt sich an zufälligen Orten, ein Ton zeigt die Entfernung. Zeigt it.moveTo und every().',
    project: () => ({
      name: 'Fangen',
      script: `// Haupt-Skript: Begrüßung und Punktestand.
state.punkte = 0;
speak("Fangen! It versteckt sich. Je näher du bist, desto höher der Ton.");
`,
      levels: [
        {
          id: oid(),
          name: 'Feld',
          intro: '',
          script: `// Spiel-Logik für das Level "Feld".

// randomPoint(abstand) liefert einen Punkt, den Me UND It erreichen können
async function verstecken() {
  await it.moveTo(randomPoint(15), { speed: 150 });
}

await verstecken();

every(400, () => {
  if (it.isMoving) return;
  const d = me.distanceTo(it);
  sound.beep(1000 - Math.min(800, d * 4), 60);
  if (d < 15) {
    state.punkte++;
    speak(\`Gefangen! \${state.punkte} Punkte.\`, { interrupt: true });
    verstecken();
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
    key: 'empty',
    title: 'Leeres Projekt',
    description: 'Ein leeres Level und ein leeres Skript.',
    project: () => ({
      name: 'Neues Projekt',
      script: `// Dein Programm. Drücke ▶ Start zum Ausprobieren.
// Die API-Referenz findest du rechts im Tab "API".

speak("Los geht's!");
`,
      levels: [{
        id: oid(), name: 'Level 1', intro: '', spawn: {}, objects: [],
        script: `// Skript für dieses Level. "level" ist das geladene Level.
// Beispiel: level.zone("Ziel").onEnter(() => speak("Geschafft!"));
`,
      }],
    }),
  },
];
