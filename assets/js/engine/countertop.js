// Countertops: one continuous top over each run of base cabinets and base
// fillers standing side by side at (about) the same height, end panels
// included, at each wall and island. They are not parts: the 3D view draws
// them and the Materials report lists their lengths, but they stay out of
// the cut list, drawings and CNC.
//
// A corner cabinet's top runs into the corner; its return gets a top on the
// next wall from the front of that one. An island's top overhangs by the
// island's seating overhang at the back (past the back row's fronts on a
// back-to-back island, which has one top over both rows) and by its end
// overhang at both ends.

import { fmtMm, thickness } from './model.js';
import { isPlinth } from './part.js';
import { atOf, standOff } from './project.js';
import { locations, placement } from './room.js';
import { fmtLen, fmtSize, isImperial } from './units.js';

const TOUCH = 0.5;
// Cabinets this close in height share a top, which sits on the highest.
const LEVEL = 10;

// A space takes the top over it unless it is for a range or the like.
const inBaseRun = (spec) =>
  spec.kind === 'base' || (spec.kind === 'filler' && spec.run === 'base') || (spec.kind === 'space' && spec.run === 'base' && spec.countertop);

/** A cabinet's footprint along its location: x0/x1 and the depth to its front face from the wall. */
function footprint(p, spec, parts) {
  const faces = spec.depth + thickness(p.construction, 'front');
  // A corner cabinet: its leg along this wall, standing off both walls; the
  // top runs on into the corner.
  if (spec.corner) {
    const off = standOff(p, spec);
    return { name: spec.name, x0: spec.x, x1: spec.x + spec.width + off, top: spec.elevation + spec.height, front: off + faces };
  }
  // A space: its width, as deep as a cabinet.
  if (spec.kind === 'space') return { name: spec.name, x0: spec.x, x1: spec.x + spec.width, top: spec.elevation + spec.height, front: faces };
  let [x0, x1, front] = [Infinity, -Infinity, 0];
  // Plinth boards are left out: a joined one runs on under the cabinets beside.
  for (const part of parts) {
    if (isPlinth(part.role)) continue;
    const b = part.bbox;
    x0 = Math.min(x0, b.min[0]);
    x1 = Math.max(x1, b.min[0] + b.size[0]);
    front = Math.max(front, b.min[2] + b.size[2]);
  }
  return { name: spec.name, x0: spec.x + x0, x1: spec.x + x1, top: spec.elevation + spec.height, front };
}

/** Spans side by side (or overlapping: an island's two rows) and level
 *  joined into runs, left to right. */
function joinRuns(spans) {
  spans.sort((a, b) => a.x0 - b.x0);
  const runs = [];
  for (const s of spans) {
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.top - s.top) <= LEVEL && s.x0 < last.x1 + TOUCH) {
      last.x1 = Math.max(last.x1, s.x1);
      last.top = Math.max(last.top, s.top);
      last.front = Math.max(last.front, s.front);
      last.back = Math.max(last.back ?? 0, s.back ?? 0);
      last.cabinets.push(s.name);
    } else runs.push({ ...s, cabinets: [s.name] });
  }
  return runs;
}

/**
 * The job's countertops: { at (location name), x0, x1, y, z0, depth,
 * thickness, length, cabinets, map } with x/z along and out from their
 * location (z0 the back edge, negative where an island top overhangs its
 * back) and `map` taking that space to world space. x0/x1 include the end
 * overhangs. Empty when countertops are off.
 */
export function countertops(p, built) {
  const ct = p.construction.countertop;
  if (!ct?.enabled) return [];
  const locs = locations(p);
  const spansAt = new Map(locs.map((l) => [l.id, []]));
  p.cabinets.forEach((spec, i) => {
    const parts = built[i]?.cabinet?.parts;
    if (!inBaseRun(spec) || !parts) return;
    spansAt.get(atOf(p, spec))?.push(footprint(p, spec, parts));
  });
  // A corner cabinet's return: a top on the next wall from the front of its own.
  locs.forEach((loc, k) => {
    if (loc.kind !== 'wall' || k === 0 || loc.wall.turn !== 'inside') return;
    const prev = locs[k - 1];
    p.cabinets.forEach((spec, i) => {
      if (!spec.corner || !inBaseRun(spec) || !built[i]?.cabinet || atOf(p, spec) !== prev.id) return;
      const off = standOff(p, spec);
      const front = off + spec.depth + thickness(p.construction, 'front');
      spansAt.get(loc.id).push({ name: spec.name, x0: front + ct.frontOverhang, x1: off + spec.corner.return, top: spec.elevation + spec.height, front });
    });
  });
  const tops = [];
  for (const loc of locs) {
    const island = loc.kind === 'island' ? loc.island : null;
    if (island?.type === 'double' && loc.row === 'back') continue; // joined into the front row's top
    let spans = spansAt.get(loc.id);
    if (island?.type === 'double') {
      // The back row, in front-row space: x runs the other way from the far end.
      const back = spansAt.get(`i${island.id}b`).map((s) => ({ ...s, x0: loc.length - s.x1, x1: loc.length - s.x0, back: s.front, front: 0 }));
      spans = [...spans, ...back];
    }
    for (const r of joinRuns(spans)) {
      const ends = ct.endOverhang + (island?.ends ?? 0);
      const [x0, x1] = [r.x0 - ends, r.x1 + ends];
      // Behind an island's front row: its seating overhang past the backs, or
      // past the back row's fronts on a back-to-back island.
      const seat = island?.overhang ?? 0;
      const behind = island ? (island.type === 'double' ? (r.back ?? 0) + ct.frontOverhang + seat : seat) : 0;
      const z0 = -behind;
      const depth = r.front + ct.frontOverhang + behind;
      const map = placement(loc, { x: 0, elevation: 0 });
      tops.push({ at: loc.name, x0, x1, y: r.top, z0, depth, thickness: ct.thickness, length: x1 - x0, cabinets: r.cabinets, map });
    }
  }
  return tops;
}

/** "Wall 1: Base 1 – Base 3" */
export function runLabel(top) {
  const c = top.cabinets;
  return `${top.at}: ${c.length === 1 ? c[0] : `${c[0]} – ${c[c.length - 1]}`}`;
}

/** "2400 × 650 × 30 mm" */
export function topSize(top) {
  return isImperial() ? `${fmtSize(top.length, top.depth)} × ${fmtLen(top.thickness)}` : `${fmtMm(top.length)} × ${fmtMm(top.depth)} × ${fmtMm(top.thickness)} mm`;
}
