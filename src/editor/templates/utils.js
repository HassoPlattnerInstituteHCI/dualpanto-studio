// Helper functions for template project definitions.
// Coordinates are millimetres on the working area (360 × 210 mm, origin top-left, y downwards).

export const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

let n = 0;
export const oid = () => 'o' + ++n;
