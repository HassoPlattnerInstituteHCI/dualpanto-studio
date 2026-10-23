// Reachable working areas of the two handles (DualPanto "Ember").
//
// Source: unity-dualpanto-toolkit/Assets/Resources/ember_area.svg, which the Unity
// toolkit shows as "EmberWorkingArea" (Panto.prefab: built-in Plane, scale 3.8 = 380 mm,
// centred at device y = +5 mm, rotated 180°). The SVG contains two mirrored shapes; the
// assignment to the handles was checked against the linkage geometry in
// dualpantoframework/hardware/ember.json (upper panto = Me reaches further to +x,
// lower panto = It further to -x; ~98 % of each shape is kinematically reachable).
//
// Coordinates: world millimetres (origin top-left of the 360 × 210 mm range, y down).
// SVG → device: x = (sx − 298.7) · 380/597.4, y = 5 + (298.7 − sy) · 380/597.4
// device → world: x_w = x + 180, y_w = 5 − y

const pts = (a) => a.map(([x, y]) => ({ x, y }));

const ME = [[176.4,6.2],[170.9,14.2],[164.4,21.7],[157.1,28.7],[149.1,34.9],[140.2,40.3],[130.7,44.8],[120.6,48.1],[109.9,50.2],[98.6,51.0],[86.9,50.3],[88.8,60.6],[91.5,70.6],[94.8,80.5],[98.8,90.1],[103.6,99.5],[109.0,108.7],[115.1,117.7],[121.9,126.5],[129.4,135.1],[137.5,143.6],[146.3,151.5],[155.7,158.7],[165.7,165.0],[176.3,170.5],[187.4,175.0],[199.0,178.6],[211.2,181.1],[223.7,182.6],[236.7,183.0],[250.2,182.2],[254.1,181.9],[258.3,181.6],[262.6,181.0],[267.2,179.8],[272.0,177.9],[276.9,175.0],[282.1,170.9],[287.4,165.3],[293.0,158.0],[298.8,148.7],[304.1,138.4],[308.4,128.2],[311.8,118.2],[314.4,108.6],[316.3,99.5],[317.5,91.0],[318.2,83.3],[318.5,76.5],[318.5,70.8],[318.2,66.2],[297.8,74.7],[278.2,78.3],[259.7,77.6],[242.6,73.2],[227.0,65.9],[213.2,56.2],[201.5,44.9],[192.1,32.6],[185.2,19.9]];
const IT = [[183.6,6.2],[189.1,14.2],[195.6,21.7],[202.9,28.7],[210.9,34.9],[219.8,40.3],[229.3,44.8],[239.4,48.1],[250.1,50.2],[261.4,51.0],[273.1,50.3],[271.2,60.6],[268.5,70.6],[265.2,80.5],[261.2,90.1],[256.4,99.5],[251.0,108.7],[244.9,117.7],[238.1,126.5],[230.6,135.1],[222.5,143.6],[213.7,151.5],[204.3,158.7],[194.3,165.0],[183.7,170.5],[172.6,175.0],[161.0,178.6],[148.8,181.1],[136.3,182.6],[123.3,183.0],[109.8,182.2],[105.9,181.9],[101.7,181.6],[97.4,181.0],[92.8,179.8],[88.0,177.9],[83.1,175.0],[77.9,170.9],[72.6,165.3],[67.0,158.0],[61.2,148.7],[55.9,138.4],[51.6,128.2],[48.2,118.2],[45.6,108.6],[43.7,99.5],[42.5,91.0],[41.8,83.3],[41.5,76.5],[41.5,70.8],[41.8,66.2],[62.2,74.7],[81.8,78.3],[100.3,77.6],[117.4,73.2],[133.0,65.9],[146.8,56.2],[158.5,44.9],[167.9,32.6],[174.8,19.9]];

export const EMBER_AREAS = { me: pts(ME), it: pts(IT) };

/**
 * Standard editor view presets:
 * - square: The biggest square covered by the range of both Me and It handles (83 × 83 mm).
 * - rhombus: The biggest rhombus covered by both handles (diagonals 152.5 × 143.5 mm, axis-aligned,
 *   found by a grid search over centres and aspect ratios, 1 mm inside the outlines).
 * - both: The whole area covered by both Me and It handles (172 × 160 mm).
 * - single: Maximum zoom containing the areas reached by only one of the handles (277 × 177 mm).
 * - full: Full device workspace (360 × 210 mm).
 */
export const EDITOR_VIEWS = {
  square: {
    key: 'square',
    label: 'Biggest square (Me & It)',
    title: 'The biggest square covered by the range of the Me and It handle (83 × 83 mm)',
    box: { x: 138.7, y: 61.9, w: 82.6, h: 82.6 },
  },
  rhombus: {
    key: 'rhombus',
    label: 'Biggest rhombus (Me & It)',
    title: 'The biggest rhombus covered by the range of the Me and It handle (152 × 143 mm)',
    box: { x: 103.5, y: 26, w: 152.5, h: 143.5 },
    points: pts([[180, 26], [256, 97.5], [180, 169.5], [103.5, 97.5]]),
  },
  both: {
    key: 'both',
    label: 'Covered by both (Me & It)',
    title: 'The whole area covered by both the Me and It handle (172 × 160 mm)',
    box: { x: 93.9, y: 11.8, w: 172.2, h: 160.2 },
  },
  single: {
    key: 'single',
    label: 'Single handles (max zoom)',
    title: 'Maximum zoom with areas reached by only one of the handles (277 × 177 mm)',
    box: { x: 41.5, y: 6.2, w: 277.0, h: 176.8 },
  },
  full: {
    key: 'full',
    label: 'Full workspace (360 × 210 mm)',
    title: 'Full workspace (360 × 210 mm)',
    box: { x: 0, y: 0, w: 360, h: 210 },
  },
};

/**
 * The outline a level is restricted to ("view": "square" or "rhombus"), or null for the
 * full area. `{ points, x, y, width, height }` in world mm.
 */
export function workAreaFor(view) {
  if (view !== 'square' && view !== 'rhombus') return null;
  const { box, points } = EDITOR_VIEWS[view];
  const outline = points ?? pts([[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]]);
  return { points: outline, x: box.x, y: box.y, width: box.w, height: box.h };
}
