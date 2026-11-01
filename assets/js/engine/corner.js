// Corner cabinets: they stand at the end of a wall and return along the
// next one (an inside corner). In cabinet space the cabinet's own wall is
// z = 0 and the next wall x = width; the return runs along it to z = return.
// The back corner, where the walls meet, is cut off at 45° (`chamfer` along
// each wall) so the case clears an out-of-square corner.
//
//   base, 'L':        two doors, one on each leg, each `opening` wide. The
//                     doors meet in the inside corner: the return's door
//                     tucks behind the first door's edge.
//   wall, 'diagonal': one door on the 45° diagonal between the two sides
//                     (600 × 600 legs, 320 deep: a 395 mm door).
//
// Parts on the return (its end side, back and door) are built in the
// return's own frame, as on the next wall (part.frame, see project.js
// partMap); the chamfer back and a diagonal door in a 45° frame. Bottoms,
// tops and shelves are flat panels with a plan outline (part.plan, x/z in
// cabinet space) and the same outline in part space (part.outline, for the
// CNC and drawings).

import { BuildError } from './build.js';
import { defaultConstruction, fmtMm, newCabinet, thickness } from './model.js';
import { EDGES, addBore, box } from './part.js';
import { fmtLenU } from './units.js';

const S = Math.SQRT1_2;

/**
 * A new corner cabinet for the end of a wall (base: an L with two doors;
 * wall: one 45° door), sized from the construction's corner defaults. Its
 * width is the leg along its own wall, `corner.return` the leg along the next.
 */
export function newCorner(kind, id = 0, c = null) {
  const job = c ?? defaultConstruction();
  const cc = job.corner;
  const spec = { ...newCabinet(kind, id, c), name: `Corner ${kind} ${id}`, shelves: 1 };
  if (kind === 'wall') {
    return { ...spec, width: cc.wallSize, corner: { type: 'diagonal', return: cc.wallSize, chamfer: cc.chamfer } };
  }
  const base = { ...spec, depth: cc.baseDepth, corner: { type: 'L', chamfer: cc.chamfer } };
  const legs = cornerLegs(base, job, cc.openingA, cc.openingB);
  return { ...base, width: legs.width, corner: { ...base.corner, return: legs.return } };
}

/** Door sizes of a corner cabinet from its legs: { openingA, openingB } for
 *  an L, { door } (the diagonal door's width) for a diagonal one. */
export function cornerDoors(spec, c) {
  const ft = thickness(c, 'front');
  const r = c.reveals.side;
  const d = spec.depth;
  if (spec.corner.type === 'diagonal') {
    return { door: Math.hypot(spec.width - d, spec.corner.return - d) - 2 * r };
  }
  return { openingA: spec.width - d - ft - c.reveals.gap - r, openingB: spec.corner.return - d - r };
}

/** The legs ({ width, return }) for the door openings of an L corner. */
export function cornerLegs(spec, c, openingA, openingB) {
  const ft = thickness(c, 'front');
  const r = c.reveals.side;
  return { width: spec.depth + ft + c.reveals.gap + openingA + r, return: spec.depth + openingB + r };
}

/** Plan outline from above (cabinet space, fronts included). */
export function cornerFootprint(spec, c) {
  const { width: W, depth: d } = spec;
  const W2 = spec.corner.return;
  const ch = spec.corner.chamfer;
  const ft = thickness(c, 'front');
  const back = [
    [0, 0],
    [W - ch, 0],
    [W, ch],
    [W, W2],
  ];
  if (spec.corner.type === 'diagonal') return [...back, [W - d, W2], [0, d]];
  return [...back, [W - d - ft, W2], [W - d - ft, d + ft], [0, d + ft]];
}

// ---- polygons --------------------------------------------------------------

const area = (poly) => poly.reduce((a, p, i) => a + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0) / 2;

/** Intersection of lines a1→a2 and b1→b2. */
function meet(a1, a2, b1, b2) {
  const [dx1, dz1, dx2, dz2] = [a2[0] - a1[0], a2[1] - a1[1], b2[0] - b1[0], b2[1] - b1[1]];
  const den = dx1 * dz2 - dz1 * dx2;
  const k = ((b1[0] - a1[0]) * dz2 - (b1[1] - a1[1]) * dx2) / den;
  return [a1[0] + dx1 * k, a1[1] + dz1 * k];
}

/**
 * The inside of the case in plan, inside the backs and the sides, its fronts
 * `inset` back from the case fronts and its sides `side` in from the side
 * panels: the outline of the bottom, top (inset 0) and shelves.
 */
function insidePlan(b, inset, side) {
  const { w: W, d, t } = b;
  const W2 = b.spec.corner.return;
  const ch = b.spec.corner.chamfer;
  const bt = b.interiorZ0;
  // The chamfer back's inside face: the 45° line moved in by its thickness.
  const o = bt * Math.SQRT2;
  const c1 = [W - ch - o, 0];
  const c2 = [W, ch + o];
  const a = meet(c1, c2, [0, bt], [1, bt]);
  const bb = meet(c1, c2, [W - bt, 0], [W - bt, 1]);
  const [s, df] = [t + side, d - inset];
  if (b.spec.corner.type === 'diagonal') {
    // Front: the diagonal between the two sides' inside front corners, moved back.
    const p1 = [t, d];
    const p2 = [W - d, W2 - t];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = [-(p2[1] - p1[1]) / len, (p2[0] - p1[0]) / len]; // out of the front
    const q1 = [p1[0] - n[0] * inset, p1[1] - n[1] * inset];
    const q2 = [p2[0] - n[0] * inset, p2[1] - n[1] * inset];
    return [[s, bt], a, bb, [W - bt, W2 - s], meet(q1, q2, [0, W2 - s], [1, W2 - s]), meet(q1, q2, [s, 0], [s, 1])];
  }
  return [[s, bt], a, bb, [W - bt, W2 - s], [W - df, W2 - s], [W - df, df], [s, df]];
}

/** A flat panel (bottom, top, shelf) on the plan outline `plan`, at height y. */
function flatPanel(name, role, plan, y, t, edges) {
  const xs = plan.map((p) => p[0]);
  const zs = plan.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  // Part space: x along the length (cabinet x), y back from the front edge (L1).
  let outline = plan.map(([x, z]) => [x - x0, z1 - z]);
  if (area(outline) < 0) outline = outline.reverse();
  return {
    name,
    role,
    material: 'case',
    length: x1 - x0,
    width: z1 - z0,
    thickness: t,
    edges,
    bbox: box([x0, y, z0], [x1 - x0, t, z1 - z0]),
    plan,
    outline,
    ops: [],
  };
}

// ---- building --------------------------------------------------------------

/** Builds a corner cabinet's parts on Builder `b` (sides, bottom, top, backs,
 *  shelves, doors, toe kick). */
export function cornerParts(b) {
  const { spec, c, t, w: W, d, y0, caseH } = b;
  const W2 = spec.corner.return;
  const ch = spec.corner.chamfer;
  const bt = b.interiorZ0;
  const ft = thickness(c, 'front');
  const r = c.reveals;
  const diagonal = spec.corner.type === 'diagonal';
  if (!(ch >= 0 && ch < Math.min(W, W2) - d)) throw new BuildError(`${spec.name}: the corner chamfer must be between 0 and ${fmtLenU(Math.min(W, W2) - d)}`);
  if (W2 < d + 100) throw new BuildError(`${spec.name}: the return must be at least ${fmtLenU(d + 100)}`);
  if (W < d + 100) throw new BuildError(`${spec.name}: the width must be at least ${fmtLenU(d + 100)}`);

  // The return, seen as on the next wall: x along it from the corner, z out of it.
  const ret = { origin: [W, 0], u: [0, 1], n: [-1, 0] };
  b.right = { ...b.right, name: 'Return side', bbox: box([W2 - t, y0, 0], [t, caseH, d]), frame: ret };

  // Shaped panels say so: the cut list gives their bounding size.
  const shape = diagonal ? 'Corner' : 'L';
  b.parts.push(flatPanel(`${shape} bottom`, 'bottom', insidePlan(b, 0, 0), y0, t, EDGES.l1()));
  b.parts.push(flatPanel(`${shape} top`, 'top', insidePlan(b, 0, 0), y0 + caseH - t, t, EDGES.l1()));

  // Backs: along each wall and across the chamfer, full case height.
  const back = (name, length, bbox, frame) => ({ name, role: 'back', material: 'case', length: caseH, width: length, thickness: bt, edges: EDGES.none(), bbox, frame, ops: [] });
  b.parts.push(back('Back', W - ch - t, box([t, y0, 0], [W - ch - t, caseH, bt])));
  b.parts.push(back('Return back', W2 - ch - t, box([ch, y0, 0], [W2 - ch - t, caseH, bt]), ret));
  if (ch > 0) {
    b.parts.push(back('Corner back', ch * Math.SQRT2, box([0, y0, 0], [ch * Math.SQRT2, caseH, bt]), { origin: [W - ch, 0], u: [S, S], n: [-S, S] }));
  }

  // Shelves; their system holes go in after the doors' plates have their holes.
  const n = spec.shelves;
  for (let i = 1; i <= n; i++) {
    const target = t + ((caseH - 2 * t) * i) / (n + 1);
    const x = Math.min(Math.max(b.snap(target), t), caseH - 2 * t);
    b.parts.push(flatPanel(`${shape} shelf`, 'shelf', insidePlan(b, c.shelfFrontSetback, c.shelfSideClearance), y0 + x, t, EDGES.l1()));
  }

  // Doors.
  const [dy0, dy1] = [y0 + r.bottom, y0 + caseH - r.top];
  const door = (name, x0, len, frame) => ({
    name,
    role: 'door',
    material: 'front',
    length: dy1 - dy0,
    width: len,
    thickness: ft,
    edges: EDGES.all(),
    bbox: box([x0, dy0, frame?.flat ? 0 : d], [len, dy1 - dy0, ft]),
    frame: frame?.frame,
    ops: [],
  });
  const hang = (part, hingeLeft) => {
    const boring = b.hinges(part, hingeLeft);
    part.hinge = { name: c.hinge.name, count: part.ops.filter((o) => o.purpose === 'hingeCup').length, k: boring.k, cupCenter: boring.cupCenter, plate: boring.plate };
    b.parts.push(part);
  };
  if (diagonal) {
    const p1 = [0, d];
    const p2 = [W - d, W2];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const u = [(p2[0] - p1[0]) / len, (p2[1] - p1[1]) / len];
    if (len - 2 * r.side < 100) throw new BuildError(`${spec.name}: the diagonal door would be under 100 mm`);
    hang(door('Corner door', r.side, len - 2 * r.side, { flat: true, frame: { origin: p1, u, n: [-u[1], u[0]] } }), true);
  } else {
    const { openingA, openingB } = cornerDoors(spec, c);
    if (openingA < 100 || openingB < 100) throw new BuildError(`${spec.name}: the doors would be under 100 mm`);
    hang(door('Left door', r.side, openingA), true);
    hang(door('Return door', d, openingB, { frame: ret }), false);
  }

  // System holes in both sides.
  const s = c.system;
  const lines = b.gridLines(t + s.endClearance, caseH - t - s.endClearance);
  for (const side of [b.left, b.right]) {
    for (const x of lines) for (const y of b.systemLineYs()) addBore(side, x, y, s.diameter, s.depth, 'system');
  }

  // Toe kick: a board under each leg, meeting in the inside corner.
  if (y0 > 0) {
    const sb = c.toeKickSetback;
    const kick = (name, x0, len, frame) => ({
      name,
      role: 'toeKick',
      material: 'case',
      length: len,
      width: y0,
      thickness: t,
      edges: EDGES.none(),
      bbox: box([x0, 0, d - sb - t], [len, y0, t]),
      frame,
      ops: [],
    });
    b.parts.push(kick('Toe kick', 0, W - d + sb + t));
    b.parts.push(kick('Return toe kick', d - sb, W2 - d + sb, ret));
  }
}
