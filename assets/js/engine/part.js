// Output model: parts, their placement in 3D, and their machining.
//
// A part is:
//   { name, role, material (slot), length (grain), width, thickness,
//     edges: { l1, l2, w1, w2 }, bbox: { min: [x,y,z], size: [x,y,z] }, ops: [] }
//
// bbox is in cabinet space: x left→right, y floor→up, z back→front (z = 0 is
// the rear of the case, z = depth its front edge).
//
// Machining is in part-local coordinates on the drawn face: x along the
// length, y across the width. L edges run along the length (L1 at y = 0),
// W edges across it (W1 at x = 0).
//   { type: 'bore', x, y, diameter, depth, purpose: 'system'|'hingeCup'|'hingePlate'|'slide' }
//   { type: 'groove', y, width, depth }            full-length groove
//   { type: 'pocket', x, y, length, width, depth } rectangular dado
//   { type: 'opening', x, y, length, width }       hole cut through the
//                                                  middle (a shaker frame's)
//   { type: 'rabbet', x, y, length, width, depth, lip }
//                                                  rectangular rabbet around
//                                                  an opening `lip` inside it
//
// Parts with dadoes also carry `cuts`: the removed volumes as boxes in
// cabinet space, so 3D views and overlap checks see the real solid.

export function isFront(role) {
  return role === 'door' || role === 'drawerFront';
}

/** A shaker front's center panel. */
export function isFrontPanel(role) {
  return role === 'frontPanel';
}

/** A length × width rectangle with corners rounded to `r`, as an outline
 *  (corners counter-clockwise), each corner's arc in `steps` straight runs. */
export function roundedRect(length, width, r, steps = 6) {
  const corners = [
    [length - r, r, -90],
    [length - r, width - r, 0],
    [r, width - r, 90],
    [r, r, 180],
  ];
  return corners.flatMap(([cx, cy, from]) =>
    Array.from({ length: steps + 1 }, (_, k) => {
      const a = ((from + (90 * k) / steps) * Math.PI) / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }),
  );
}

/** A face frame's stile or rail (solid wood, see project.js faceFrames). */
export function isFramePart(role) {
  return role === 'frameStile' || role === 'frameRail';
}

export function isPlinth(role) {
  return role === 'toeKick' || role === 'plinthRear' || role === 'plinthEnd' || role === 'toeKickCover';
}

export function isDrawerBox(role) {
  return role === 'drawerSide' || role === 'drawerSubFront' || role === 'drawerBack' || role === 'drawerBottom';
}

/** Groups for showing / hiding parts in the views. */
export const PART_GROUPS = {
  sides: 'Sides',
  bottomTop: 'Bottom & top',
  stretchers: 'Stretchers',
  back: 'Back',
  shelves: 'Shelves',
  plinth: 'Plinth',
  fronts: 'Fronts',
  fillers: 'Fillers',
  drawerBoxes: 'Drawer boxes',
  endPanels: 'End panels',
  faceFrames: 'Face frames',
  // Not part groups: the countertops over the base runs, appliance sketches
  // in their spaces and the room's walls.
  countertop: 'Countertop',
  appliances: 'Appliances',
  walls: 'Walls',
};

export function partGroup(role) {
  if (role === 'leftSide' || role === 'rightSide') return 'sides';
  if (role === 'bottom' || role === 'top') return 'bottomTop';
  if (role === 'frontStretcher' || role === 'rearStretcher') return 'stretchers';
  if (role === 'shelf' || role === 'fixedShelf') return 'shelves';
  if (isPlinth(role)) return 'plinth';
  if (isFront(role) || isFrontPanel(role)) return 'fronts';
  if (role === 'filler') return 'fillers';
  if (isDrawerBox(role)) return 'drawerBoxes';
  if (role === 'endPanel') return 'endPanels';
  if (isFramePart(role)) return 'faceFrames';
  return role; // 'back'
}

export const EDGES = {
  none: () => ({ l1: false, l2: false, w1: false, w2: false }),
  l1: () => ({ l1: true, l2: false, w1: false, w2: false }),
  all: () => ({ l1: true, l2: true, w1: true, w2: true }),
};

// Edge banding is set per part type in the construction: which edges
// (edgeBanding) and which band (partBands). `edges` names each edge as it
// sits on that part: L1/L2 run along the length, W1/W2 across it. `slot` is
// the material the parts are cut from, whose band they used before
// partBands existed.
const FBLR = { l1: 'Front', l2: 'Back', w1: 'Left', w2: 'Right' };
export const BAND_PARTS = {
  side: { label: 'Sides', slot: 'case', edges: { l1: 'Front', l2: 'Back', w1: 'Bottom', w2: 'Top' } },
  bottomTop: { label: 'Bottom & top', slot: 'case', edges: FBLR },
  frontStretcher: { label: 'Front stretcher', slot: 'case', edges: FBLR },
  rearStretcher: { label: 'Rear stretcher', slot: 'case', edges: FBLR },
  shelf: { label: 'Shelves', slot: 'case', edges: FBLR },
  back: { label: 'Back', slot: 'case', edges: { l1: 'Left', l2: 'Right', w1: 'Bottom', w2: 'Top' } },
  door: { label: 'Doors', slot: 'front', edges: { l1: 'Left', l2: 'Right', w1: 'Bottom', w2: 'Top' } },
  drawerFront: { label: 'Drawer fronts', slot: 'front', edges: { l1: 'Bottom', l2: 'Top', w1: 'Left', w2: 'Right' } },
  endPanel: { label: 'End panels', slot: 'front', edges: { l1: 'Front', l2: 'Back', w1: 'Bottom', w2: 'Top' } },
  filler: { label: 'Fillers', slot: 'front', edges: { l1: 'Left', l2: 'Right', w1: 'Bottom', w2: 'Top' } },
  plinth: { label: 'Plinth & toe kick', slot: 'case', edges: { l1: 'Bottom', l2: 'Top', w1: 'End', w2: 'End' } },
  drawerBox: { label: 'Drawer boxes', slot: 'drawerBox', edges: { l1: 'Long edge', l2: 'Long edge', w1: 'Short edge', w2: 'Short edge' } },
};

export function bandGroup(role) {
  if (role === 'leftSide' || role === 'rightSide') return 'side';
  if (role === 'bottom' || role === 'top') return 'bottomTop';
  // A toe-kick cover is banded like a filler, from the front material.
  if (role === 'toeKickCover') return 'filler';
  // Fixed shelves and dividers are banded like the shelves.
  if (role === 'fixedShelf') return 'shelf';
  if (isPlinth(role)) return 'plinth';
  if (isDrawerBox(role)) return 'drawerBox';
  return role; // frontStretcher, rearStretcher, shelf, back, door, drawerFront, endPanel, filler
}

/** The banded edges of a part with this role under construction `c`. */
export function bandEdges(c, role) {
  return { ...EDGES.none(), ...c.edgeBanding?.[bandGroup(role)] };
}

export function edgeCode(e) {
  return ['l1', 'l2', 'w1', 'w2'].filter((k) => e[k]).map((k) => k.toUpperCase()).join(' ');
}

export function box(min, size) {
  return { min, size };
}

export function boxMax(b) {
  return [b.min[0] + b.size[0], b.min[1] + b.size[1], b.min[2] + b.size[2]];
}

/** Overlap of two boxes, or null when they only touch or are apart. */
export function boxIntersection(a, b, eps = 1e-6) {
  const min = [0, 1, 2].map((i) => Math.max(a.min[i], b.min[i]));
  const max = [0, 1, 2].map((i) => Math.min(a.min[i] + a.size[i], b.min[i] + b.size[i]));
  if (max.some((v, i) => v - min[i] <= eps)) return null;
  return box(min, max.map((v, i) => v - min[i]));
}

/** `a` with `b` removed, as up to six disjoint boxes. */
export function boxMinus(a, b) {
  const cut = boxIntersection(a, b);
  if (!cut) return [a];
  const out = [];
  let rest = a;
  // Peel off the slabs on either side of the cut, one axis at a time.
  for (let i = 0; i < 3; i++) {
    const [lo, hi] = [cut.min[i], cut.min[i] + cut.size[i]];
    const [rlo, rhi] = [rest.min[i], rest.min[i] + rest.size[i]];
    const slab = (from, to) => {
      const min = [...rest.min];
      const size = [...rest.size];
      min[i] = from;
      size[i] = to - from;
      return box(min, size);
    };
    if (lo > rlo) out.push(slab(rlo, lo));
    if (hi < rhi) out.push(slab(hi, rhi));
    rest = slab(lo, hi);
  }
  return out;
}

/** The part's solid as disjoint boxes: its bbox minus its cuts (dadoes). */
export function partSolids(part) {
  return (part.cuts ?? []).reduce((pieces, cut) => pieces.flatMap((p) => boxMinus(p, cut)), [part.bbox]);
}

/** Size to cut before edge banding is applied: [length, width]. */
export function cutSize(part, band) {
  const e = part.edges;
  return [part.length - band * (e.w1 + e.w2), part.width - band * (e.l1 + e.l2)];
}

/** Adds a bore unless one already exists at that position (system lines
 *  and hinge plates share holes). */
export function addBore(part, x, y, diameter, depth, purpose) {
  const exists = part.ops.some((op) => op.type === 'bore' && Math.abs(op.x - x) < 0.01 && Math.abs(op.y - y) < 0.01);
  if (!exists) part.ops.push({ type: 'bore', x, y, diameter, depth, purpose });
}

/**
 * Where a part's bores are drilled, in the space of `min`/`size` (its bbox,
 * in cabinet or world space): `at(x, y)` maps part-local bore coordinates
 * onto the drilled face, `out` is the face's outward normal. Null for a part
 * whose drilled face isn't known.
 */
export function boreFace(part, min, size) {
  const top = min[2] + size[2];
  switch (part.role) {
    // Sides: x up from the bottom, y back from the front edge, on the inside face.
    case 'leftSide':
      return { at: (x, y) => [min[0] + size[0], min[1] + x, top - y], out: [1, 0, 0] };
    case 'rightSide':
      return { at: (x, y) => [min[0], min[1] + x, top - y], out: [-1, 0, 0] };
    // Doors: x up from the bottom, y from the left edge, on the back face.
    case 'door':
      return { at: (x, y) => [min[0] + y, min[1] + x, min[2]], out: [0, 0, -1] };
    default:
      return null;
  }
}

export function bores(part) {
  return part.ops.filter((op) => op.type === 'bore');
}
