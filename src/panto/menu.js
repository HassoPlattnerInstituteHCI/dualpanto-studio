// Haptic list menu: a rail guides the handle, and each item announces itself in a zone.

export function createMenu(rt, { speak, sound, onKey }, items, opts = {}) {
  const {
    x = 190,
    y = 55,
    spacing = 25,
    width = 120,
    title = '',
    onSelect = () => {},
    onFocus = () => {},
    strength = 6,
    moveHandle = true,
    announceIndex = true,
  } = opts;

  let keys = [];

  const menu = {
    items: [],
    focused: -1,
    _parts: [],
    get length() {
      return this.items.length;
    },
    remove() {
      clearItems();
      keys.forEach((off) => off());
      keys = [];
    },
    select(i = this.focused) {
      if (i >= 0 && i < this.items.length) {
        rt._guard(onSelect)(this.items[i], i, menu);
      }
    },
    setItems(newItems) {
      const keep = this.focused;
      clearItems();
      build(newItems);
      this.focused = Math.min(keep, this.items.length - 1);
    },
  };

  const label = (it) => (typeof it === 'string' ? it : it?.label ?? String(it));

  function clearItems() {
    menu._parts.forEach((p) => p.remove());
    menu._parts = [];
  }

  function build(list) {
    menu.items = [...list];
    const n = menu.items.length;
    if (n > 1) {
      menu._parts.push(
        rt.createRail([{ x, y }, { x, y: y + spacing * (n - 1) }], {
          strength,
          handles: 'me',
          name: 'menu-rail',
        })
      );
    }
    menu.items.forEach((item, i) => {
      const z = rt.createZone(
        { x: x - width / 2, y: y + i * spacing - spacing / 2, w: width, h: spacing },
        { name: `menu:${i}`, label: label(item) }
      );
      z.onEnter(() => {
        menu.focused = i;
        sound.tick();
        speak(label(item) + (announceIndex ? `, ${i + 1} of ${n}` : ''), { interrupt: true });
        rt._guard(onFocus)(item, i, menu);
      });
      menu._parts.push(z);
    });
  }

  build(items);
  keys = [onKey('Enter', () => menu.select()), onKey('Space', () => menu.select())];
  if (title) speak(title, { interrupt: true });
  if (moveHandle && items.length) {
    rt.me.moveTo({ x, y }).then(() => {
      // If the person (or a voice command) has already selected something in the
      // meantime, don't interrupt and don't reset the selection.
      if (!rt.running || menu.focused >= 0) return;
      menu.focused = 0;
      speak(label(menu.items[0]) + (announceIndex ? `, 1 of ${menu.items.length}` : ''));
    });
  }
  return menu;
}
