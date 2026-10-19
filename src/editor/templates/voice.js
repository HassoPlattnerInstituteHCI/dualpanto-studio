export default {
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
};
