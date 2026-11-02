// Room layout: walls at 90° to each other and free-standing islands. Each is
// a location cabinets stand at; a cabinet's x runs along its location from
// the location's start, and its back is at the location's line.
//
// Plan space (top view) is world x and z: wall 1 runs along +x from the
// origin with the room in +z, as in the 3D view (fronts face +z).
//
// A location's frame is { origin: [x, z], u, n }: u runs along it, n points
// out of it into the room (the way the fronts face). Cabinet space maps on
// as x → u, z → n, y up.
//
//   room: { walls: [{ id, name, length, turn }], islands: [{ id, name, x, z,
//           rotation, type, overhang, ends }], height, wallColor, nextId }
//
// `height` is the ceiling: how high the 3D view draws the walls, in
// `wallColor`.
//
// A wall's `turn` is how it meets the wall before it: 'inside' (the usual
// corner, turning toward the room) or 'outside' (a jog out). An island is
// turned `rotation` degrees (0, 90, 180, 270) with the top-left corner of
// its cabinets in the plan at (x, z) whichever way it faces, so turning it
// spins it in place; a 'double' island has a second row back to back with
// the first. Island rows fill left to right in the plan (top to bottom when
// turned 90° or 270°): see reversed. `overhang` is the countertop's seating overhang at the
// back (past the back row's fronts on a back-to-back island), `ends` its
// overhang past both ends.

import { frontProjection } from './model.js';

export const TURNS = { inside: 'Inside corner', outside: 'Outside corner' };
export const ISLAND_TYPES = { single: 'Single run', double: 'Back to back' };

export const DEFAULT_WALL_COLOR = '#ccc7bd';

export function defaultRoom() {
  return { walls: [{ id: 1, name: 'Wall 1', length: 3600, turn: 'inside' }], islands: [], height: 2400, wallColor: DEFAULT_WALL_COLOR, nextId: 2 };
}

/** Adds a room to jobs saved before rooms existed: one wall, long enough
 *  for the cabinets, which all stand at it. */
export function ensureRoom(p) {
  if (!p.room) {
    p.room = defaultRoom();
    const right = Math.max(0, ...p.cabinets.map((c) => c.x + c.width));
    p.room.walls[0].length = Math.max(3600, Math.ceil(right / 100) * 100);
  }
  for (const spec of p.cabinets) if (!spec.at || !locationById(p, spec.at)) spec.at = `w${p.room.walls[0].id}`;
  return p;
}

/** The job's room (a default one for jobs built without, as in tests). */
function roomOf(p) {
  return p.room ?? (p.room = defaultRoom());
}

const rotate = ([x, z], deg) => {
  const k = (((Math.round(deg / 90) % 4) + 4) % 4);
  return [
    [x, z],
    [-z, x],
    [-x, -z],
    [z, -x],
  ][k];
};
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const neg = ([x, z]) => [-x || 0, -z || 0];

/**
 * Every place cabinets can stand, in order: the walls, then each island's
 * front row and (double islands) back row. { id, name, kind: 'wall' |
 * 'island', origin, u, n, length, wall | island, prev (the wall before, for
 * walls), row }.
 */
export function locations(p) {
  const out = [];
  const room = roomOf(p);
  let frame = { origin: [0, 0], u: [1, 0], n: [0, 1] };
  room.walls.forEach((wall, i) => {
    if (i > 0) {
      const prev = out[out.length - 1];
      const origin = add(prev.origin, prev.u, prev.length);
      frame = wall.turn === 'outside' ? { origin, u: neg(prev.n), n: prev.u } : { origin, u: prev.n, n: neg(prev.u) };
    }
    out.push({ id: `w${wall.id}`, name: wall.name, kind: 'wall', ...frame, length: wall.length, wall, index: i });
  });
  for (const island of room.islands) {
    const u = rotate([1, 0], island.rotation);
    const n = rotate([0, 1], island.rotation);
    // The rows' extent: along u, and out from the back line (front row) and
    // behind it (back row); (x, z) is that box's top-left in the plan.
    const length = islandLength(p, island);
    const ahead = rowDepth(p, `i${island.id}`);
    const behind = island.type === 'double' ? rowDepth(p, `i${island.id}b`) : 0;
    const corners = [0, length].flatMap((s) => [-behind, ahead].map((d) => add([u[0] * s, u[1] * s], n, d)));
    const min = [0, 1].map((k) => Math.min(...corners.map((q) => q[k])));
    const origin = [island.x - min[0], island.z - min[1]];
    const front = { id: `i${island.id}`, name: island.type === 'double' ? `${island.name} (front)` : island.name, kind: 'island', origin, u, n, island, row: 'front' };
    out.push(front);
    if (island.type === 'double') {
      // Back to back: the back row runs the other way from the far end.
      out.push({ id: `i${island.id}b`, name: `${island.name} (back)`, kind: 'island', origin: add(origin, u, length), u: neg(u), n: neg(n), island, row: 'back' });
    }
  }
  for (const loc of out) if (loc.kind === 'island') loc.length = islandLength(p, loc.island);
  return out;
}

export function locationById(p, id) {
  return locations(p).find((l) => l.id === id) ?? null;
}

/** Where a cabinet stands (the first wall if its location is gone). */
export function locationOf(p, spec) {
  const all = locations(p);
  return all.find((l) => l.id === spec.at) ?? all[0];
}

/** How deep an island row's cabinets stand, fronts included (a standard
 *  base when it has none yet). */
function rowDepth(p, id) {
  const c = p.construction;
  const front = c ? frontProjection(c) : 0;
  const depths = p.cabinets.filter((s) => s.at === id).map((s) => s.depth);
  return (depths.length ? Math.max(...depths) : (c?.cabinetSizes?.base?.depth ?? 600)) + front;
}

/** Whether a location's cabinets fill it from its end, so that list order
 *  reads left to right (top to bottom) in the plan: island rows running
 *  right to left or bottom to top there. */
export function reversed(loc) {
  return loc.kind === 'island' && (loc.u[0] < -0.5 || loc.u[1] < -0.5);
}

/** An island is as long as its longest row of cabinets (at least 600). */
export function islandLength(p, island) {
  const ids = [`i${island.id}`, `i${island.id}b`];
  const right = p.cabinets.filter((c) => ids.includes(c.at)).reduce((m, c) => Math.max(m, c.x + c.width), 0);
  return Math.max(600, right);
}

/**
 * Maps cabinet space of the cabinet `spec` (standing at x along `loc`,
 * `standOff` out from its line) to world space: point(p) for points, dir(v)
 * for directions.
 */
export function placement(loc, spec, standOff = 0) {
  const { origin, u, n } = loc;
  return {
    point: ([x, y, z]) => {
      const s = spec.x + x;
      const d = standOff + z;
      return [origin[0] + u[0] * s + n[0] * d, spec.elevation + y, origin[1] + u[1] * s + n[1] * d];
    },
    dir: ([x, y, z]) => [u[0] * x + n[0] * z, y, u[1] * x + n[1] * z],
  };
}

/** World point → { s (along the location), y, d (out from its line) }. */
export function toLocation(loc, [x, y, z]) {
  const [dx, dz] = [x - loc.origin[0], z - loc.origin[1]];
  return { s: dx * loc.u[0] + dz * loc.u[1], y, d: dx * loc.n[0] + dz * loc.n[1] };
}

// ---- editing the room ----------------------------------------------------------

export function addWall(p) {
  const id = p.room.nextId++;
  p.room.walls.push({ id, name: `Wall ${p.room.walls.length + 1}`, length: 3000, turn: 'inside' });
  return `w${id}`;
}

export function addIsland(p) {
  const id = p.room.nextId++;
  const n = p.room.islands.length + 1;
  // Out in the room, in front of the first wall.
  p.room.islands.push({ id, name: `Island ${n}`, x: 600, z: 1800 + (n - 1) * 1500, rotation: 0, type: 'single', overhang: 300, ends: 0 });
  return `i${id}`;
}

/** Removes a wall or island; its cabinets move to the first wall. */
export function removeLocation(p, kind, id) {
  if (kind === 'wall') {
    if (p.room.walls.length <= 1) return;
    p.room.walls = p.room.walls.filter((w) => w.id !== id);
  } else {
    p.room.islands = p.room.islands.filter((i) => i.id !== id);
  }
  const first = `w${p.room.walls[0].id}`;
  const gone = kind === 'wall' ? [`w${id}`] : [`i${id}`, `i${id}b`];
  for (const spec of p.cabinets) if (gone.includes(spec.at)) spec.at = first;
}
