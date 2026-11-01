// CNC router programs: the parts picked for the CNC, nested on the stock that
// fits the table, drilled and cut out with one end mill, as GRBL G-code.
//
// Machine coordinates: X along the stock's length, Y across it, X0 Y0 at its
// front-left corner, Z0 on top of the material (cutting depths negative).
// Each part lies drilled face up. Holes the tool's size are plunged; bigger
// ones are bored in a helix. Dadoes are cleared from the top; through notches
// shape the outline. The outline is cut outside the part in depth
// passes, ramping down along it and entered and left on a small tangent arc,
// with (triangle) tabs holding the part on the last passes.

import { bandThickness, fmtMm, partMaterial } from './model.js';
import { boreFace, bores, cutSize } from './part.js';
import { MM_PER_IN, fmtLenU, unitName } from './units.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const EPS = 0.05;

/**
 * A part as it lies on the table, drilled face up: its cut size (length
 * along x), and as seen from above, measured from the cut edges (edge banding
 * goes on afterwards): its holes, its pockets (dadoes and rabbets, cut from
 * the top: { x0, y0, x1, y1, depth }), a shaker frame's openings
 * ({ x0, y0, x1, y1 }, cut through) and the rabbets around them
 * ({ x0, y0, x1, y1, depth, lip }), and its outline when through notches
 * make it more than a rectangle (corners counter-clockwise).
 */
export function tablePart(c, part) {
  const band = bandThickness(c, part);
  const e = part.edges;
  const [length, width] = cutSize(part, band);
  const fromW1 = e.w1 ? band : 0;
  const face = boreFace(part, part.bbox.min, part.bbox.size);
  // Seen from outside the drilled face with the length to the right, the
  // part's y runs either up (from L1) or down (from L2, mirrored).
  let mirrored = false;
  if (face) {
    const o = face.at(0, 0);
    const up = cross(face.out, sub(face.at(1, 0), o));
    mirrored = dot(sub(face.at(0, 1), o), up) < 0;
  }
  const at = (x, y) => [x - fromW1, mirrored ? part.width - y - (e.l2 ? band : 0) : y - (e.l1 ? band : 0)];
  const holes = bores(part).map((b) => {
    const [x, y] = at(b.x, b.y);
    return { x, y, diameter: b.diameter, depth: b.depth, purpose: b.purpose };
  });
  // Pockets and notches, clipped to the cut rectangle; a shaker frame's
  // opening and the rabbet around it.
  const rect = (x, y, l, w) => {
    const [ax, ay] = at(x, y);
    const [bx, by] = at(x + l, y + w);
    return {
      x0: Math.max(Math.min(ax, bx), 0),
      y0: Math.max(Math.min(ay, by), 0),
      x1: Math.min(Math.max(ax, bx), length),
      y1: Math.min(Math.max(ay, by), width),
    };
  };
  const pockets = [];
  const notches = [];
  const openings = [];
  const rabbets = [];
  for (const op of part.ops) {
    if (op.type === 'opening') openings.push(rect(op.x, op.y, op.length, op.width));
    if (op.type === 'rabbet') rabbets.push({ ...rect(op.x, op.y, op.length, op.width), depth: op.depth, lip: op.lip });
    if (op.type !== 'pocket' && op.type !== 'groove') continue;
    const r = op.type === 'groove' ? rect(0, op.y, part.length, op.width) : rect(op.x, op.y, op.length, op.width);
    if (r.x1 - r.x0 < EPS || r.y1 - r.y0 < EPS) continue;
    if (op.depth >= part.thickness - EPS) notches.push(r);
    else pockets.push({ ...r, depth: op.depth });
  }
  // A shaped panel (a corner cabinet's L or 45° bottom, top or shelf) is cut
  // on its own outline, to its finished size.
  if (part.outline) return { length: part.length, width: part.width, thickness: part.thickness, holes, pockets, outline: part.outline };
  return {
    length,
    width,
    thickness: part.thickness,
    holes,
    pockets,
    openings,
    rabbets,
    outline: notches.length ? notchedOutline(length, width, notches) : null,
  };
}

/**
 * The outline of a length × width rectangle with rectangular notches cut
 * through it from its edges, as corners counter-clockwise: the boundary of
 * the cells (between every notch edge) left standing, the outer loop only.
 */
export function notchedOutline(length, width, notches) {
  const xs = [...new Set([0, length, ...notches.flatMap((n) => [n.x0, n.x1])])].sort((a, b) => a - b);
  const ys = [...new Set([0, width, ...notches.flatMap((n) => [n.y0, n.y1])])].sort((a, b) => a - b);
  const solid = (i, j) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const [cx, cy] = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2];
    return !notches.some((n) => cx > n.x0 && cx < n.x1 && cy > n.y0 && cy < n.y1);
  };
  // Boundary edges with the part on their left, keyed by their start.
  const next = new Map();
  const key = (p) => `${p[0]},${p[1]}`;
  const edge = (a, b) => next.set(key(a), { a, b });
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!solid(i, j)) continue;
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      if (!solid(i, j - 1)) edge([x0, y0], [x1, y0]);
      if (!solid(i + 1, j)) edge([x1, y0], [x1, y1]);
      if (!solid(i, j + 1)) edge([x1, y1], [x0, y1]);
      if (!solid(i - 1, j)) edge([x0, y1], [x0, y0]);
    }
  }
  // Walk the loop from the lowest-left edge, keeping only the corners.
  const first = [...next.values()].sort((a, b) => a.a[1] - b.a[1] || a.a[0] - b.a[0])[0];
  const loop = [];
  let e = first;
  do {
    loop.push(e.a);
    e = next.get(key(e.b));
  } while (e && e !== first && loop.length <= next.size);
  return loop.filter((p, k) => {
    const [a, b] = [loop[(k + loop.length - 1) % loop.length], loop[(k + 1) % loop.length]];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9;
  });
}

/**
 * The picked parts (keys `${cabinet id}:${part index}`) grouped by material,
 * ready for nesting on the stock: [{ material, items }], each material
 * carrying the stock size as its sheet size.
 */
export function cncGroups(project, built, picked) {
  const c = project.construction;
  const cfg = c.cnc;
  const groups = new Map();
  project.cabinets.forEach((spec, i) => {
    const cab = built[i]?.cabinet;
    if (!cab) return;
    cab.parts.forEach((part, index) => {
      const key = `${spec.id}:${index}`;
      if (!picked.has(key)) return;
      const mat = partMaterial(c, part);
      if (!mat) return;
      if (!groups.has(mat.id)) {
        groups.set(mat.id, { material: { ...mat, sheetLength: cfg.stockX, sheetWidth: cfg.stockY }, items: [] });
      }
      groups.get(mat.id).items.push({ key, name: part.name, cabinet: cab.name, ...tablePart(c, part) });
    });
  });
  return [...groups.values()].sort((a, b) => a.material.id - b.material.id);
}

/** Nesting settings that keep the tool (and its lead-in) clear of the
 *  neighbouring parts and the stock edge. */
export function cncNesting(cfg) {
  return { kerf: cfg.spacing, trim: cfg.margin, mode: 'cnc', effort: 'normal', group: false };
}

/** Problems with the settings, as sentences. */
export function cncWarnings(cfg) {
  const out = [];
  const d = cfg.toolDiameter;
  const lead = cfg.leadIn ? cfg.leadInRadius : 0;
  if (cfg.stockX > cfg.tableX + EPS || cfg.stockY > cfg.tableY + EPS) out.push('The stock is bigger than the table.');
  if (cfg.spacing < d + lead - EPS) {
    out.push(`Parts are ${fmtLenU(cfg.spacing)} apart: the ${fmtLenU(d)} tool${lead ? ` and ${fmtLenU(lead)} lead-in` : ''} need ${fmtLenU(d + lead)}, or the cut-out reaches the next part.`);
  }
  if (cfg.margin < d / 2 + lead - EPS) out.push(`The ${fmtLenU(cfg.margin)} margin leaves the tool${lead ? ' and lead-in' : ''} no room inside the stock edge (${fmtLenU(d / 2 + lead)} needed).`);
  if (!(cfg.passDepth > 0)) out.push('Pass depth must be more than 0.');
  return out;
}

/** Where a nested part's point (x, y) on the part lands on the stock. */
export function onStock(p, x, y) {
  return p.rotated ? [p.x + p.width - y, p.y + x] : [p.x + x, p.y + y];
}

/** A rectangle { x0, y0, x1, y1 } on a nested part, on the stock. */
export function stockRect(p, r) {
  const [a, b] = [onStock(p, r.x0, r.y0), onStock(p, r.x1, r.y1)];
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}

/** A nested part's outline on the stock, corners counter-clockwise. */
export function stockOutline(p) {
  return p.outline ? p.outline.map(([x, y]) => onStock(p, x, y)) : [[p.x, p.y], [p.x + p.sizeX, p.y], [p.x + p.sizeX, p.y + p.sizeY], [p.x, p.y + p.sizeY]];
}

// ---- toolpaths -------------------------------------------------------------
//
// A program is a list of moves: { g: 0 | 1, x, y, z, f } and arcs { g: 2 | 3
// (clockwise | counter-clockwise), x, y, z, i, j, f } (i, j: centre from the
// start), plus { comment }.

class Program {
  constructor(cfg) {
    this.cfg = cfg;
    this.moves = [];
    this.at = { x: 0, y: 0, z: cfg.safeZ };
  }
  comment(text) {
    this.moves.push({ comment: text });
  }
  rapid(to) {
    const m = { g: 0, ...this.at, ...to };
    this.moves.push(m);
    this.at = { x: m.x, y: m.y, z: m.z };
  }
  line(to, f = this.cfg.feed) {
    const m = { g: 1, ...this.at, ...to, f };
    this.moves.push(m);
    this.at = { x: m.x, y: m.y, z: m.z };
  }
  arc(cw, to, centre, f = this.cfg.feed) {
    const m = { g: cw ? 2 : 3, ...this.at, ...to, i: centre[0] - this.at.x, j: centre[1] - this.at.y, f };
    this.moves.push(m);
    this.at = { x: m.x, y: m.y, z: m.z };
  }
  /** Up to the clearance height, across, and down to it from the safe height. */
  goTo(x, y) {
    if (this.at.z < this.cfg.clearZ) this.rapid({ z: this.cfg.clearZ });
    this.rapid({ x, y });
    if (this.at.z > this.cfg.clearZ) this.rapid({ z: this.cfg.clearZ });
  }
}

/** Drills or bores one hole at (cx, cy). Returns a warning, or null. */
function hole(pr, cx, cy, h, thickness) {
  const cfg = pr.cfg;
  const d = cfg.toolDiameter;
  const depth = Math.min(h.depth, thickness + cfg.cutThrough);
  if (h.diameter < d - EPS) return `Ø${fmtMm(h.diameter)}${unitName() === 'in' ? ' mm' : ''} holes are smaller than the ${fmtLenU(d)} tool and were left out.`;
  const r = (h.diameter - d) / 2;
  if (r < EPS) {
    // The tool's own size: plunge, or peck. A full retract comes out of the
    // hole after each peck and rapids back to just above its bottom; a chip
    // break only backs off chipBreak.
    pr.goTo(cx, cy);
    const peck = cfg.peckDrill && cfg.peck > 0 ? cfg.peck : depth;
    const full = cfg.peckRetract !== 'chip';
    const back = Math.max(cfg.chipBreak, 0.1);
    for (let z = 0; z < depth - 1e-9; ) {
      if (z > 0 && full) pr.rapid({ z: -z + back });
      z = Math.min(z + peck, depth);
      pr.line({ z: -z }, cfg.plungeFeed);
      if (z < depth - 1e-9) pr.rapid({ z: full ? cfg.clearZ : -z + back });
    }
    pr.rapid({ z: cfg.clearZ });
    return null;
  }
  // Bigger: a helix down the wall, a flat turn at the bottom, out from the centre.
  const cw = cfg.direction !== 'conventional'; // climb inside a hole is clockwise
  const start = [cx + r, cy];
  pr.goTo(...start);
  pr.line({ z: 0 }, cfg.plungeFeed);
  for (let z = 0; z < depth - 1e-9; ) {
    z = Math.min(z + cfg.helixPitch, depth);
    pr.arc(cw, { x: start[0], y: start[1], z: -z }, [cx, cy]);
  }
  pr.arc(cw, { x: start[0], y: start[1] }, [cx, cy]);
  pr.line({ x: cx, y: cy });
  pr.rapid({ z: cfg.clearZ });
  return null;
}

/**
 * The tool centre's path around a part's outline (corners counter-clockwise),
 * one tool radius outside it: round about the outside corners, meeting in a
 * point in the inside ones (which keep the tool's radius). It starts and ends
 * in the middle of the longest side. Climb milling goes counter-clockwise
 * around the outside (with the spindle turning clockwise).
 */
function outline(poly, r, ccw) {
  const n = poly.length;
  const dir = (a, b) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const t = poly.map((p, i) => dir(p, poly[(i + 1) % n]));
  const out = t.map(([x, y]) => [y, -x]);
  const off = (p, v, k = r) => [p[0] + v[0] * k, p[1] + v[1] * k];
  // Each side's offset start and end, and the arcs around the outside corners.
  const start = [];
  const end = [];
  const corner = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const v = poly[j];
    const turn = t[i][0] * t[j][1] - t[i][1] * t[j][0];
    if (turn > 1e-9) {
      end[i] = off(v, out[i]);
      start[j] = off(v, out[j]);
      corner[i] = { c: v };
    } else {
      const k = r / (1 + out[i][0] * out[j][0] + out[i][1] * out[j][1]);
      end[i] = start[j] = [v[0] + (out[i][0] + out[j][0]) * k, v[1] + (out[i][1] + out[j][1]) * k];
    }
  }
  const longest = poly.reduce((best, p, i) => (Math.hypot(...sub(poly[(i + 1) % n], p)) > Math.hypot(...sub(poly[(best + 1) % n], poly[best])) ? i : best), 0);
  const mid = [(start[longest][0] + end[longest][0]) / 2, (start[longest][1] + end[longest][1]) / 2];
  let segs = [{ line: true, a: mid, b: end[longest] }];
  for (let k = 1; k <= n; k++) {
    const i = (longest + k) % n;
    const prev = (i + n - 1) % n;
    if (corner[prev]) segs.push({ line: false, a: end[prev], b: start[i], c: corner[prev].c, cw: false });
    segs.push({ line: true, a: start[i], b: i === longest ? mid : end[i] });
  }
  segs = segs.filter((s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 1e-9);
  if (!ccw) segs = segs.reverse().map((s) => ({ ...s, a: s.b, b: s.a, cw: s.line ? undefined : true }));
  for (const s of segs) {
    if (s.line) s.len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    else {
      const [u, v] = [sub(s.a, s.c), sub(s.b, s.c)];
      s.angle = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
      s.len = s.angle * r;
    }
  }
  return segs;
}

/** The point and direction of travel `d` along a path. */
function pointAt(segs, d) {
  let along = 0;
  for (const s of segs) {
    if (d <= along + s.len + 1e-9 || s === segs[segs.length - 1]) {
      const f = s.len ? Math.min(Math.max((d - along) / s.len, 0), 1) : 0;
      if (s.line) {
        const t = [(s.b[0] - s.a[0]) / s.len, (s.b[1] - s.a[1]) / s.len];
        return { p: [s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f], t };
      }
      const r = Math.hypot(s.a[0] - s.c[0], s.a[1] - s.c[1]);
      const a = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]) + (s.cw ? -1 : 1) * s.angle * f;
      const t = s.cw ? [Math.sin(a), -Math.cos(a)] : [-Math.sin(a), Math.cos(a)];
      return { p: [s.c[0] + r * Math.cos(a), s.c[1] + r * Math.sin(a)], t };
    }
    along += s.len;
  }
}

/**
 * Where the tabs go: [from, to] stretches of the path (distances along it)
 * where the tool rises over a tab, each on a straight side, clear of the
 * corners, of the entry at the start (`keepStart`) and of the end.
 */
function tabSpans(segs, cfg, keepStart, keepEnd) {
  const total = segs.reduce((n, s) => n + s.len, 0);
  const half = (cfg.tabLength + cfg.toolDiameter) / 2;
  // Places a tab centre may be, along the straight sides.
  const room = [];
  let along = 0;
  for (const s of segs) {
    if (s.line) {
      const lo = Math.max(along + half + 1, keepStart + half);
      const hi = Math.min(along + s.len - half - 1, total - keepEnd - half);
      if (hi >= lo) room.push([lo, hi]);
    }
    along += s.len;
  }
  if (!room.length) return [];
  const n = Math.max(2, Math.round(total / cfg.tabSpacing));
  const spans = [];
  for (let k = 0; k < n; k++) {
    const want = ((k + 0.5) * total) / n;
    let best = null;
    for (const [lo, hi] of room) {
      const at = Math.min(Math.max(want, lo), hi);
      if (best === null || Math.abs(at - want) < Math.abs(best - want)) best = at;
    }
    if (spans.every(([a, b]) => best - half > b + cfg.toolDiameter || best + half < a - cfg.toolDiameter)) spans.push([best - half, best + half]);
  }
  return spans.sort((a, b) => a[0] - b[0]);
}

/**
 * Cuts one part out in depth passes around its outline. With ramping, the
 * tool comes down along the outline (each pass ramps from the last depth over
 * the first `rampLength` of the path, the last ramp is cleaned up at full
 * depth), so it never plunges beside the part; the lead-in arc only brings it
 * onto the path, a lead-in radius outside it. Below the tab top the tool
 * rises over the tabs: triangles (one slope up and down, gentler on the end
 * mill, the same triangle on every pass) or square.
 *
 * A clockwise `poly` is cut from inside instead (a shaker frame's opening):
 * the same climb or conventional direction, the lead-in and the tabs on the
 * scrap side. `depth` stops short of cutting through (a rabbet, without
 * tabs).
 */
function profile(pr, poly, thickness, warnings, { depth = thickness + pr.cfg.cutThrough, tabs = true } = {}) {
  const cfg = pr.cfg;
  const r = cfg.toolDiameter / 2;
  const ccw = cfg.direction !== 'conventional';
  const segs = outline(poly, r, ccw);
  const total = segs.reduce((n, s) => n + s.len, 0);
  const full = depth;
  const tabTop = -(thickness - cfg.tabHeight);
  const ramp = cfg.ramp ? Math.min(Math.max(cfg.rampLength, 1), total / 2) : 0;
  const lead = cfg.leadIn ? cfg.leadInRadius : 0;
  const useTabs = tabs && cfg.tabs && cfg.tabHeight > 0 && cfg.tabHeight < thickness;
  const spans = useTabs ? tabSpans(segs, cfg, Math.max(ramp, lead), lead) : [];
  if (useTabs && spans.length < 2) warnings.add('Some parts are too small for two tabs; they have fewer.');
  const triangle = cfg.tabShape !== 'square';

  /** Rises over the tab [a, b] of the line `s` (its start `along` the path) at depth z. */
  const overTab = (s, along, a, b, z) => {
    const point = (d) => [s.a[0] + ((s.b[0] - s.a[0]) * (d - along)) / s.len, s.a[1] + ((s.b[1] - s.a[1]) * (d - along)) / s.len];
    if (triangle) {
      // The triangle's base spans [a, b] at full depth; at z it is this wide.
      const mid = (a + b) / 2;
      const w = (((b - a) / 2) * (tabTop - z)) / (tabTop + full);
      const [ax, ay] = point(mid - w);
      const [mx, my] = point(mid);
      const [bx, by] = point(mid + w);
      pr.line({ x: ax, y: ay });
      pr.line({ x: mx, y: my, z: tabTop });
      pr.line({ x: bx, y: by, z });
    } else {
      const [ax, ay] = point(a);
      const [bx, by] = point(b);
      pr.line({ x: ax, y: ay });
      pr.line({ z: tabTop }, cfg.plungeFeed);
      pr.line({ x: bx, y: by });
      pr.line({ z }, cfg.plungeFeed);
    }
  };

  /** Follows the path from `from` to `to` (distances along it), at depth zAt(d). */
  const follow = (from, to, zAt, lifts = []) => {
    let along = 0;
    for (const s of segs) {
      const lo = Math.max(from, along);
      const hi = Math.min(to, along + s.len);
      if (hi > lo + 1e-9) {
        const { p } = pointAt(segs, hi);
        if (s.line) {
          for (const [a, b] of lifts) if (a >= lo - 1e-9 && b <= hi + 1e-9) overTab(s, along, a, b, zAt(a));
          pr.line({ x: p[0], y: p[1], z: zAt(hi) });
        } else {
          pr.arc(s.cw, { x: p[0], y: p[1], z: zAt(hi) }, s.c);
        }
      }
      along += s.len;
    }
  };

  // A quarter arc of the lead-in radius, outside the path, tangent to it at
  // `d`: onto the path (entering) or off it.
  const leadArc = (d, entering) => {
    const { p, t } = pointAt(segs, d);
    const out = ccw ? [t[1], -t[0]] : [-t[1], t[0]];
    const c = [p[0] + out[0] * lead, p[1] + out[1] * lead];
    const far = entering ? [c[0] - t[0] * lead, c[1] - t[1] * lead] : [c[0] + t[0] * lead, c[1] + t[1] * lead];
    const [a, b] = entering ? [far, p] : [p, far];
    const cw = (a[0] - c[0]) * (b[1] - c[1]) - (a[1] - c[1]) * (b[0] - c[0]) < 0;
    return { start: a, end: b, c, cw };
  };
  const enter = (z) => {
    const start = pointAt(segs, 0).p;
    if (lead > 0) {
      const arc = leadArc(0, true);
      pr.goTo(...arc.start);
      pr.line({ z }, cfg.plungeFeed);
      pr.arc(arc.cw, { x: start[0], y: start[1] }, arc.c);
    } else {
      pr.goTo(...start);
      pr.line({ z }, cfg.plungeFeed);
    }
  };
  const leave = (d) => {
    if (lead > 0) {
      const arc = leadArc(d, false);
      pr.arc(arc.cw, { x: arc.end[0], y: arc.end[1] }, arc.c);
    }
    pr.rapid({ z: cfg.clearZ });
  };

  const passes = Math.max(1, Math.ceil(full / cfg.passDepth - 1e-9));
  const depths = Array.from({ length: passes }, (_, k) => -Math.min((k + 1) * cfg.passDepth, full));
  const liftsAt = (z) => (z < tabTop - 1e-9 ? spans : []);
  if (ramp > 0) {
    enter(0);
    let z = 0;
    for (const zk of depths) {
      const z0 = z;
      follow(0, ramp, (d) => z0 + ((zk - z0) * d) / ramp);
      follow(ramp, total, () => zk, liftsAt(zk));
      z = zk;
    }
    follow(0, ramp, () => z);
    leave(ramp);
  } else {
    for (const zk of depths) {
      enter(zk);
      follow(0, total, () => zk, liftsAt(zk));
      leave(0);
    }
  }
}

/**
 * Clears a pocket { x0, y0, x1, y1, depth } (stock coordinates) in a part
 * whose rectangle is `part`, from the top: back and forth along its length a
 * stepover apart, ramping down along the first pass (or plunging), in depth
 * passes. Its sides on the part's edges are open: the passes run out to them,
 * so a rabbet comes out clean; closed sides are cut straight by the passes'
 * ends and the outermost passes.
 */
function pocket(pr, pk, part, warnings) {
  const cfg = pr.cfg;
  const r = cfg.toolDiameter / 2;
  const open = {
    x0: Math.abs(pk.x0 - part.x0) < EPS,
    x1: Math.abs(pk.x1 - part.x1) < EPS,
    y0: Math.abs(pk.y0 - part.y0) < EPS,
    y1: Math.abs(pk.y1 - part.y1) < EPS,
  };
  const alongX = pk.x1 - pk.x0 >= pk.y1 - pk.y0;
  // Tool centre range: the passes run out to open ends; everything else stays a radius inside.
  const [a0, a1, b0, b1] = alongX
    ? [open.x0 ? pk.x0 : pk.x0 + r, open.x1 ? pk.x1 : pk.x1 - r, pk.y0 + r, pk.y1 - r]
    : [open.y0 ? pk.y0 : pk.y0 + r, open.y1 ? pk.y1 : pk.y1 - r, pk.x0 + r, pk.x1 - r];
  if (b1 < b0 - EPS || a1 < a0 - EPS) {
    warnings.add(`A ${fmtLenU(Math.min(pk.x1 - pk.x0, pk.y1 - pk.y0))} dado is narrower than the ${fmtLenU(cfg.toolDiameter)} tool and was left out.`);
    return;
  }
  const step = Math.max(cfg.toolDiameter * (cfg.stepover / 100), 0.1);
  const lines = Math.max(1, Math.ceil((b1 - b0) / step - 1e-9));
  const across = Array.from({ length: lines + 1 }, (_, k) => (lines ? b0 + ((b1 - b0) * k) / lines : b0));
  if (b1 - b0 < EPS) across.length = 1;
  const xy = (a, b) => (alongX ? { x: a, y: b } : { x: b, y: a });
  const len = a1 - a0;
  const passes = Math.max(1, Math.ceil(pk.depth / cfg.passDepth - 1e-9));
  let z = 0;
  for (let k = 1; k <= passes; k++) {
    const zk = -Math.min(k * cfg.passDepth, pk.depth);
    const p0 = xy(a0, across[0]);
    pr.goTo(p0.x, p0.y);
    if (cfg.ramp && len > 1) {
      // Back and forth along the first pass, no steeper than the outline's ramp.
      pr.line({ z }, cfg.plungeFeed);
      const run = ((z - zk) / cfg.passDepth) * Math.max(cfg.rampLength, 1);
      let [done, pos, dir] = [0, a0, 1];
      while (done < run - 1e-9) {
        const d = Math.min(dir > 0 ? a1 - pos : pos - a0, run - done);
        done += d;
        pos += dir * d;
        pr.line({ ...xy(pos, across[0]), z: z + ((zk - z) * done) / run });
        if (pos >= a1 - 1e-9 || pos <= a0 + 1e-9) dir = -dir;
      }
      pr.line({ ...p0, z: zk });
    } else {
      pr.line({ z: zk }, cfg.plungeFeed);
    }
    across.forEach((b, i) => {
      if (i > 0) pr.line(xy(i % 2 ? a1 : a0, b));
      pr.line(xy(i % 2 ? a0 : a1, b));
    });
    pr.rapid({ z: cfg.clearZ });
    z = zk;
  }
}

/** A rectangle { x0, y0, x1, y1 } as corners, clockwise. */
const clockwise = (r) => [[r.x0, r.y0], [r.x0, r.y1], [r.x1, r.y1], [r.x1, r.y0]];

/**
 * Clears the rabbet around a shaker frame's opening (stock coordinates: its
 * outside { x0, y0, x1, y1, depth, lip }): laps around the inside of its
 * outer edge, a stepover apart, until the tool has covered the lip. What it
 * cuts beyond the lip is in the opening, cut out afterwards; the rabbet's
 * corners keep the tool's radius.
 */
function rabbet(pr, rb, thickness, warnings) {
  const cfg = pr.cfg;
  const d = cfg.toolDiameter;
  const step = Math.max(d * (cfg.stepover / 100), 0.1);
  const laps = Math.max(0, Math.ceil((rb.lip - d) / step - 1e-9));
  for (let k = 0; k <= laps; k++) {
    const k0 = Math.min(k * step, Math.max(rb.lip - d, 0));
    const r = { x0: rb.x0 + k0, y0: rb.y0 + k0, x1: rb.x1 - k0, y1: rb.y1 - k0 };
    profile(pr, clockwise(r), thickness, warnings, { depth: rb.depth, tabs: false });
  }
}

/**
 * The program for one nested sheet: drilling, dadoes and rabbets first
 * (while the stock is whole), then the parts cut out, smallest first, each
 * one's openings before its outline. Returns { moves, warnings, minutes }.
 */
export function sheetProgram(sheet, cfg, thickness) {
  const pr = new Program(cfg);
  const warnings = new Set();
  if (cfg.drill) {
    // Nearest hole next, from the origin.
    const todo = sheet.parts.flatMap((p) => p.holes.map((h) => ({ h, at: onStock(p, h.x, h.y), part: p })));
    let here = [0, 0];
    if (todo.length) pr.comment('Drilling');
    while (todo.length) {
      let k = 0;
      todo.forEach((t, i) => {
        if (Math.hypot(t.at[0] - here[0], t.at[1] - here[1]) < Math.hypot(todo[k].at[0] - here[0], todo[k].at[1] - here[1])) k = i;
      });
      const [t] = todo.splice(k, 1);
      const w = hole(pr, t.at[0], t.at[1], t.h, thickness);
      if (w) warnings.add(w);
      here = t.at;
    }
  }
  if (cfg.pockets) {
    for (const p of sheet.parts) {
      const rect = { x0: p.x, y0: p.y, x1: p.x + p.sizeX, y1: p.y + p.sizeY };
      for (const pk of p.pockets ?? []) {
        pr.comment(`Dado in #${p.number} ${p.name} - ${fmtMm(pk.depth)} deep`);
        pocket(pr, { ...stockRect(p, pk), depth: pk.depth }, rect, warnings);
      }
      for (const rb of p.rabbets ?? []) {
        pr.comment(`Rabbet in #${p.number} ${p.name} - ${fmtMm(rb.lip)} wide, ${Math.round(rb.depth * 100) / 100} deep`);
        rabbet(pr, { ...stockRect(p, rb), depth: rb.depth, lip: rb.lip }, thickness, warnings);
      }
    }
  }
  if (cfg.profile) {
    const order = [...sheet.parts].sort((a, b) => a.sizeX * a.sizeY - b.sizeX * b.sizeY || a.number - b.number);
    for (const p of order) {
      for (const o of p.openings ?? []) {
        pr.comment(`Opening in #${p.number} ${p.name} - ${p.cabinet}`);
        profile(pr, clockwise(stockRect(p, o)), thickness, warnings);
      }
      pr.comment(`Cut out #${p.number} ${p.name} - ${p.cabinet}`);
      profile(pr, stockOutline(p), thickness, warnings);
    }
  }
  return { moves: pr.moves, warnings: [...warnings], minutes: runMinutes(pr.moves, cfg) };
}

/** Length of a move from `from`. */
function moveLength(from, m) {
  const dz = m.z - from.z;
  if (m.g === 2 || m.g === 3) {
    const r = Math.hypot(m.i, m.j);
    const a0 = Math.atan2(from.y - (from.y + m.j), from.x - (from.x + m.i));
    const a1 = Math.atan2(m.y - (from.y + m.j), m.x - (from.x + m.i));
    let sweep = m.g === 3 ? a1 - a0 : a0 - a1;
    while (sweep <= 1e-9) sweep += 2 * Math.PI;
    return Math.hypot(r * sweep, dz);
  }
  return Math.hypot(m.x - from.x, m.y - from.y, dz);
}

function runMinutes(moves, cfg) {
  let at = { x: 0, y: 0, z: cfg.safeZ };
  let t = cfg.spindleDelay / 60;
  for (const m of moves) {
    if (m.g === undefined) continue;
    t += moveLength(at, m) / (m.g === 0 ? cfg.rapidFeed : m.f);
    at = m;
  }
  return t;
}

// ---- G-code ----------------------------------------------------------------

const n3 = (v) => {
  const s = (Math.round(v * 1000) / 1000 + 0).toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};
const n4 = (v) => {
  const s = (Math.round(v * 10000) / 10000 + 0).toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};
/** Comment text GRBL and its senders take: ASCII, no parentheses. */
const ascii = (t) =>
  String(t)
    .replace(/×/g, 'x')
    .replace(/[—–]/g, '-')
    .replace(/Ø/g, 'D')
    .replace(/[()]/g, '')
    .replace(/[^\x20-\x7e]/g, '');

/** GRBL G-code for a sheet program. `title` lines go in the header. */
export function gcode(program, cfg, title = [], { units = unitName() } = {}) {
  // Moves are planned in mm; an inch program (G20) writes every length in
  // inches to 4 places and feeds in in/min.
  const inch = units === 'in';
  const len = inch ? (v) => n4(v / MM_PER_IN) : n3;
  const rate = inch ? (v) => String(Math.round((v / MM_PER_IN) * 10) / 10) : (v) => String(Math.round(v));
  const unit = inch ? 'in' : 'mm';
  const out = [...title.map((t) => `(${ascii(t)})`)];
  out.push(
    `(Stock ${len(cfg.stockX)} x ${len(cfg.stockY)} ${unit} - X0 Y0 front-left corner, Z0 top of material)`,
    `(Tool: ${len(cfg.toolDiameter)} ${unit} end mill - drilling and cut-out)`,
    `(Estimated run time ${Math.ceil(program.minutes)} min)`,
    `${inch ? 'G20' : 'G21'} G90 G17 G94`,
    `G0 Z${len(cfg.safeZ)}`,
    `M3 S${Math.round(cfg.rpm)}`,
  );
  if (cfg.spindleDelay > 0) out.push(`G4 P${n3(cfg.spindleDelay)}`);
  let at = { x: 0, y: 0, z: cfg.safeZ };
  let feed = null;
  for (const m of program.moves) {
    if (m.g === undefined) {
      out.push(`(${ascii(m.comment)})`);
      continue;
    }
    const words = [`G${m.g}`];
    if (m.g >= 2 || Math.abs(m.x - at.x) > 1e-6) words.push(`X${len(m.x)}`);
    if (m.g >= 2 || Math.abs(m.y - at.y) > 1e-6) words.push(`Y${len(m.y)}`);
    if (Math.abs(m.z - at.z) > 1e-6) words.push(`Z${len(m.z)}`);
    if (m.g >= 2) words.push(`I${len(m.i)}`, `J${len(m.j)}`);
    if (words.length === 1) continue; // no motion
    if (m.g !== 0 && m.f !== feed) {
      words.push(`F${rate(m.f)}`);
      feed = m.f;
    }
    out.push(words.join(' '));
    at = m;
  }
  out.push(`G0 Z${len(cfg.safeZ)}`, 'M5', 'G0 X0 Y0', 'M30');
  return out.join('\n') + '\n';
}
