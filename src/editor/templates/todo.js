export default {
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
};
