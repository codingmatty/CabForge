// Construction rules: turns a cabinet spec + construction into parts.
//
// Frameless, full-overlay, sides run full height. Bottom/top/stretchers are
// butt-joined between the sides. Base cabinets get front/rear stretchers
// instead of a top and stand on a plinth, or on their sides with the toe
// kick notched into them. The back fits between the sides,
// flush with the rear.

import { CABINET_KINDS, SLOTS, SLOT_LABELS, caseT, drawerSize, effectiveConstruction, fmtMm, frontSections, frontUnits, material, partBandId, thickness, toeHeight, unitFrontHeight } from './model.js';
import { cornerFootprint, cornerParts } from './corner.js';
import { EDGES, addBore, bandEdges, bandGroup, bores, box, isFront, roundedRect } from './part.js';
import { fmtLen, fmtLenU } from './units.js';

export class BuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuildError';
  }
}

/** Number of hinges for a door of the given height. */
export function hingeCount(doorHeight) {
  if (doorHeight <= 900) return 2;
  if (doorHeight <= 1600) return 3;
  if (doorHeight <= 2100) return 4;
  return 5;
}

/** A hinge table value (rows K, columns door thickness) at `k`, `t`,
 *  interpolated between entries and clamped to the table. */
function hingeTable(h, rows, k, t) {
  const at = (v, lo, n) => {
    const i = Math.min(Math.max(v - lo, 0), n - 1);
    const i0 = Math.min(Math.floor(i), n - 2);
    return [i0, i - i0];
  };
  const [r, fr] = at(k, h.kRange[0], rows.length);
  const [col, fc] = at(t, h.doorThickness[0], rows[0].length);
  const row = (i) => rows[i][col] + (rows[i][col + 1] - rows[i][col]) * fc;
  return row(r) + (row(r + 1) - row(r)) * fr;
}

/**
 * Where the hinge cups go for construction `c`: the boring distance K (door
 * edge to cup edge), the cup centre from the door edge and the plate height
 * that gives the doors their overlay of the case side. `issues` lists what
 * the hinge can't do with these doors.
 */
export function hingeBoring(c) {
  const h = c.hinge;
  const t = thickness(c, 'front');
  const reveal = c.reveals.side;
  const overlay = caseT(c) - reveal;
  const [kMin, kMax] = h.kRange;
  const issues = [];
  if (t < h.doorThickness[0] || t > h.doorThickness[1]) {
    issues.push(`${fmtMm(t)} mm doors are outside the hinge's ${h.doorThickness[0]}–${h.doorThickness[1]} mm range.`);
  }
  const gapNeeded = (k) => hingeTable(h, h.minDoorGap, k, t);
  const revealNeeded = (k) => hingeTable(h, h.minReveal, k, t);
  const swings = (k) => gapNeeded(k) <= h.doorGap + 1e-6 && revealNeeded(k) <= reveal + 1e-6;
  const plateFor = (k) => h.plateHeights.reduce((best, p) => (Math.abs(h.armOffset + k - overlay - p) < Math.abs(h.armOffset + k - overlay - best) ? p : best));
  const nearest = (list) => list.reduce((best, o) => (Math.abs(o.k - h.k) < Math.abs(best.k - h.k) ? o : best));

  let pick;
  if (h.boring === 'manual') {
    pick = { k: h.k, plate: plateFor(h.k) };
  } else {
    // Each plate height gives the exact overlay at one K; take the one
    // nearest the preferred K that lets the door swing open.
    const inRange = h.plateHeights.map((p) => ({ k: overlay + p - h.armOffset, plate: p })).filter((o) => o.k >= kMin - 1e-6 && o.k <= kMax + 1e-6);
    const ok = inRange.filter((o) => swings(o.k));
    if (ok.length) pick = nearest(ok);
    else if (inRange.length) pick = nearest(inRange);
    else {
      const k = Math.min(Math.max(overlay + plateFor(h.k) - h.armOffset, kMin), kMax);
      pick = { k, plate: plateFor(k) };
    }
  }
  const { k, plate } = pick;
  const off = overlay - (h.armOffset + k - plate);
  if (Math.abs(off) > 0.05) {
    issues.push(`K ${fmtMm(k)} with a ${fmtMm(plate)} mm plate overlays ${fmtMm(h.armOffset + k - plate)} mm, not ${fmtMm(overlay)}: take up ${fmtMm(Math.abs(off))} mm with the side adjustment (±2).`);
  }
  if (gapNeeded(k) > h.doorGap + 1e-6) {
    issues.push(`${fmtMm(t)} mm doors at K ${fmtMm(k)} need a ${fmtMm(gapNeeded(k))} mm door gap; the hinge leaves ${fmtMm(h.doorGap)}. Use a smaller K.`);
  }
  if (revealNeeded(k) > reveal + 1e-6) {
    issues.push(`${fmtMm(t)} mm doors at K ${fmtMm(k)} need a side reveal of at least ${fmtMm(revealNeeded(k))} mm (now ${fmtMm(reveal)}).`);
  }
  return { k, cupCenter: k + h.cupDiameter / 2, plate, overlay, doorThickness: t, issues };
}

/** The cabinet's outline seen from above in cabinet space ([x, z] corners,
 *  z = 0 at the back), fronts included. `jobConstruction` before overrides. */
export function footprint(spec, jobConstruction) {
  const c = effectiveConstruction(jobConstruction, spec.overrides);
  if (spec.corner) return cornerFootprint(spec, c);
  if (spec.panel) {
    // Proud of the case fronts and scribed to the wall, like an end panel.
    const ep = c.endPanel;
    return [
      [0, -ep.rearScribe],
      [spec.width, -ep.rearScribe],
      [spec.width, spec.depth + ep.frontOverhang],
      [0, spec.depth + ep.frontOverhang],
    ];
  }
  const d = spec.depth + (spec.kind === 'filler' || spec.kind === 'space' ? 0 : thickness(c, 'front'));
  return [
    [0, 0],
    [spec.width, 0],
    [spec.width, d],
    [0, d],
  ];
}

/** Builds one cabinet with the job construction `c` plus the cabinet's own
 *  overrides. Throws BuildError when the spec can't be built. */
export function buildCabinet(spec, jobConstruction) {
  // A space for an appliance: room in the run, nothing to make.
  if (spec.kind === 'space') return { specId: spec.id, name: spec.name, parts: [] };
  const c = effectiveConstruction(jobConstruction, spec.overrides);
  let parts;
  if (spec.panel) {
    parts = panelParts(spec, c);
  } else if (spec.kind === 'filler') {
    parts = fillerParts(spec, c);
  } else {
    const b = new Builder(spec, c);
    if (spec.corner) {
      cornerParts(b);
    } else {
      b.case();
      b.fronts();
      b.shelves();
      b.endPanels();
      if (c.plinth === 'sides' && b.y0 > 0) b.sidesToFloor();
    }
    parts = [b.left, b.right, ...b.parts];
  }
  if (c.frontStyle === 'shaker') parts.push(...shakerFronts(parts, c, spec.name));
  // Record the library material so cut lists and views don't need the
  // cabinet's overrides to resolve it, and band the edges the construction
  // asks for (a shaker frame is never banded).
  for (const p of parts) {
    p.materialId = c.materials[p.material];
    p.edges = p.shaker ? EDGES.none() : bandEdges(c, p.role);
    p.bandId = partBandId(c, bandGroup(p.role), p.material);
  }
  return { specId: spec.id, name: spec.name, parts };
}

/**
 * Makes the doors and drawer fronts among `parts` 2-piece shaker fronts
 * (construction `shaker`): each becomes a frame, its opening cut through and
 * a rabbet around the opening on the back as deep as the panel material is
 * thick, and gets a center panel of the panel material in the rabbet, its
 * back flush with the frame's. The panel's corners are rounded to the CNC
 * tool's radius, like the rabbet's. Fronts whose opening would be under
 * minOpening stay slab. Returns the panels.
 */
export function shakerFronts(parts, c, name) {
  const sh = c.shaker;
  const pt = thickness(c, 'panel');
  const r = c.cnc.toolDiameter / 2;
  const panels = [];
  for (const p of parts.filter((p) => isFront(p.role))) {
    const [ol, ow] = [p.length - 2 * sh.frame, p.width - 2 * sh.frame];
    if (Math.min(ol, ow) < sh.minOpening) continue;
    if (!(pt < p.thickness)) {
      throw new BuildError(`${name}: shaker panels (${fmtMm(pt)} mm) must be thinner than the ${fmtMm(p.thickness)} mm fronts`);
    }
    if (!(sh.rabbet > sh.clearance && sh.rabbet < sh.frame)) {
      throw new BuildError('Shaker rabbet must be wider than the panel clearance and narrower than the frame');
    }
    // Hinge cups stay in the frame, clear of the rabbet.
    const into = bores(p).find((b) => b.purpose === 'hingeCup' && Math.min(b.y, p.width - b.y) + b.diameter / 2 > sh.frame - sh.rabbet);
    if (into) throw new BuildError(`${name}: the hinge cups run into the shaker rabbet; the frame must be wider than ${fmtMm(Math.min(into.y, p.width - into.y) + into.diameter / 2 + sh.rabbet)} mm`);

    const lip = sh.frame - sh.rabbet;
    p.ops.push(
      { type: 'rabbet', x: lip, y: lip, length: p.length - 2 * lip, width: p.width - 2 * lip, depth: pt, lip: sh.rabbet },
      { type: 'opening', x: sh.frame, y: sh.frame, length: ol, width: ow },
    );
    p.shaker = { frame: sh.frame, rabbet: sh.rabbet, opening: [ol, ow] };
    // The frame is the same width all round, so the cuts don't depend on
    // which way the part's length runs; the back is the bbox's min z.
    const [[x0, y0, z0], [w, h, t]] = [p.bbox.min, p.bbox.size];
    const inset = (k, depth) => box([x0 + k, y0 + k, z0], [w - 2 * k, h - 2 * k, depth]);
    p.cuts = [...(p.cuts ?? []), inset(sh.frame, t), inset(lip, pt)];
    const k = lip + sh.clearance;
    const [length, width] = [p.length - 2 * k, p.width - 2 * k];
    panels.push({
      name: `${p.name} panel`,
      role: 'frontPanel',
      material: 'panel',
      length,
      width,
      thickness: pt,
      edges: EDGES.none(),
      bbox: inset(k, pt),
      frame: p.frame,
      outline: roundedRect(length, width, r),
      cornerRadius: r,
      ops: [],
    });
  }
  return panels;
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * A filler between cabinets: a strip of front material in the plane of the
 * doors, from the top of the plinth to the top of the run. Base and tall
 * fillers also get a plinth front so the toe kick runs through.
 */
function fillerParts(spec, c) {
  for (const slot of ['case', 'front']) {
    const m = material(c, slot);
    if (!m) throw new BuildError(`${SLOT_LABELS[slot]} material is missing from the library`);
    if (!(m.thickness > 0)) throw new BuildError(`${m.name} must have a thickness`);
  }
  const { width: w, depth: d } = spec;
  const toe = toeHeight(c, spec);
  const height = spec.height - toe;
  if (w < 5) throw new BuildError(`${spec.name}: filler must be at least 5 mm wide`);
  if (height < 50) throw new BuildError(`${spec.name}: filler is too low for its plinth`);
  const ft = thickness(c, 'front');
  const parts = [
    {
      name: 'Filler',
      role: 'filler',
      material: 'front',
      length: height,
      width: w,
      thickness: ft,
      // Both long edges show between the doors.
      edges: { l1: true, l2: true, w1: false, w2: false },
      bbox: box([0, toe, d], [w, height, ft]),
      ops: [],
    },
  ];
  if (toe > 0) {
    const t = caseT(c);
    const rail = (name, role, z) => ({
      name,
      role,
      material: 'case',
      length: w,
      width: toe,
      thickness: t,
      edges: EDGES.none(),
      bbox: box([0, 0, z], [w, toe, t]),
      ops: [],
    });
    parts.push(rail(c.plinth === 'frame' ? 'Plinth front' : 'Toe kick', 'toeKick', d - c.toeKickSetback - t));
    const cover = c.plinth === 'sides' ? toeKickCover(spec, c, w, d, toe) : null;
    if (cover) parts.push(cover);
    // A plinth frame runs its rear rail through too (cross members come
    // from the cabinets either side, see joinPlinths).
    if (c.plinth === 'frame') parts.push(rail('Plinth rear', 'plinthRear', 0));
  }
  return parts;
}

/**
 * A standing panel: an end panel on its own in the run, sized and notched
 * like the end panels on cabinets (see Builder.endPanels) to the run's
 * height, depth and toe kick.
 */
function panelParts(spec, c) {
  const m = material(c, 'front');
  if (!m) throw new BuildError(`${SLOT_LABELS.front} material is missing from the library`);
  if (!(m.thickness > 0)) throw new BuildError(`${m.name} must have a thickness`);
  const ep = c.endPanel;
  const et = m.thickness;
  const floorStanding = CABINET_KINDS[spec.run].toeKick;
  const below = floorStanding ? ep.floorScribe : 0;
  const length = spec.height + below;
  const width = spec.depth + ep.frontOverhang + ep.rearScribe;
  const toe = toeHeight(c, spec);
  const panel = {
    name: 'Panel',
    role: 'endPanel',
    standing: true,
    material: 'front',
    length,
    width,
    thickness: et,
    edges: EDGES.l1(),
    bbox: box([0, -below, -ep.rearScribe], [et, length, width]),
    ops: [],
  };
  if (floorStanding && ep.toeKick && toe > 0) {
    const nd = ep.toeKickDepth;
    if (!(nd > 0 && nd < width - 50)) throw new BuildError(`${spec.name}: end panel toe-kick depth must be between 0 and the panel depth less 50 mm`);
    const nh = toe + below;
    panel.ops.push({ type: 'pocket', x: 0, y: 0, length: nh, width: nd, depth: et });
    panel.cuts = [box([0, -below, width - ep.rearScribe - nd], [et, nh, nd])];
  }
  return [panel];
}

/**
 * With an integrated toe kick: a strip of front material `w` wide over the
 * face of the toe-kick board, covering the sides' notches, the full toe-kick
 * height `h`. Like a filler, it joins with the covers beside it into one
 * board (joinPlinths). Null when turned off.
 */
function toeKickCover(spec, c, w, d, h) {
  if (!c.toeKickCover) return null;
  const ft = thickness(c, 'front');
  if (!(c.toeKickSetback > ft)) throw new BuildError(`${spec.name}: base overhang must be more than the front material's thickness for a toe-kick cover`);
  return {
    name: 'Toe kick cover',
    role: 'toeKickCover',
    material: 'front',
    length: w,
    width: h,
    thickness: ft,
    edges: EDGES.none(),
    bbox: box([0, 0, d - c.toeKickSetback], [w, h, ft]),
    ops: [],
  };
}

class Builder {
  constructor(spec, c) {
    for (const slot of SLOTS) {
      const m = material(c, slot);
      if (!m) throw new BuildError(`${SLOT_LABELS[slot]} material is missing from the library`);
      if (!(m.thickness > 0)) throw new BuildError(`${m.name} must have a thickness`);
    }
    const t = caseT(c);
    // The back is cut from the case material and sits inside the case.
    const bt = t;
    const { width: w, depth: d } = spec;
    const y0 = toeHeight(c, spec);
    const caseH = spec.height - y0;

    if (c.back.type === 'dado' && !(c.back.depth >= 0 && c.back.depth < t)) {
      throw new BuildError('Back dado depth must be between 0 and the case thickness');
    }
    if (w < 2 * t + 100) throw new BuildError(`${spec.name}: width must be at least ${Math.round(2 * t + 100)}`);
    if (caseH < 2 * t + 100) throw new BuildError(`${spec.name}: height is too small for its plinth and panels`);
    if (d - bt < 100) throw new BuildError(`${spec.name}: depth leaves less than 100 mm inside`);

    Object.assign(this, { spec, c, t, w, d, y0, caseH });
    /** Front face of the back panel: the interior starts here. */
    this.interiorZ0 = bt;
    /** Side-local bays for shelves, from fronts(). */
    this.shelfZones = [];
    this.parts = [];

    const side = (name, role, x) => ({
      name,
      role,
      material: 'case',
      length: caseH,
      width: d,
      thickness: t,
      edges: EDGES.l1(),
      bbox: box([x, y0, 0], [t, caseH, d]),
      ops: [],
    });
    this.left = side('Left side', 'leftSide', 0);
    this.right = side('Right side', 'rightSide', w - t);
  }

  interiorDepth() {
    return this.d - this.interiorZ0;
  }

  /** Nearest 32mm grid line (side-local x) to `x`. */
  snap(x) {
    const s = this.c.system;
    return s.origin + Math.round((x - s.origin) / s.spacing) * s.spacing;
  }

  case() {
    const { t, w, d, y0, caseH } = this;
    const panel = (name, role, y) => ({
      name,
      role,
      material: 'case',
      length: w - 2 * t,
      width: d,
      thickness: t,
      edges: EDGES.l1(),
      bbox: box([t, y, 0], [w - 2 * t, t, d]),
      ops: [],
    });

    this.parts.push(panel('Bottom', 'bottom', y0));

    if (this.spec.kind === 'base') {
      const sw = Math.min(this.c.stretcherWidth, d / 2);
      const y = y0 + caseH - t;
      const stretcher = (name, role, z, edges) => ({
        name,
        role,
        material: 'case',
        length: w - 2 * t,
        width: sw,
        thickness: t,
        edges,
        bbox: box([t, y, z], [w - 2 * t, t, sw]),
        ops: [],
      });
      this.parts.push(stretcher('Front stretcher', 'frontStretcher', d - sw, EDGES.l1()));
      this.parts.push(stretcher('Rear stretcher', 'rearStretcher', this.interiorZ0, EDGES.none()));
    } else {
      this.parts.push(panel('Top', 'top', y0 + caseH - t));
    }

    this.back();

    if (this.y0 > 0) this.plinth();
  }

  /**
   * Finished end panels against the outside of the sides, standing
   * frontOverhang proud of the case front. Rear and floor scribe allowances
   * make them deeper and taller than the case; floor-standing cabinets get a
   * toe-kick notch at the front unless it is turned off.
   */
  endPanels() {
    const sides = this.spec.endPanels ?? {};
    if (!sides.left && !sides.right) return;
    const ep = this.c.endPanel;
    const et = thickness(this.c, 'front');
    const floorStanding = CABINET_KINDS[this.spec.kind].toeKick;
    const below = floorStanding ? ep.floorScribe : 0;
    const length = this.spec.height + below;
    const width = this.d + ep.frontOverhang + ep.rearScribe;
    const z0 = -ep.rearScribe;
    const notch = floorStanding && ep.toeKick && this.y0 > 0 ? [this.y0 + below, ep.toeKickDepth] : null;
    if (notch && !(notch[1] > 0 && notch[1] < width - 50)) {
      throw new BuildError(`${this.spec.name}: end panel toe-kick depth must be between 0 and the panel depth less 50 mm`);
    }
    for (const [key, name, x] of [
      ['left', 'Left end panel', -et],
      ['right', 'Right end panel', this.w],
    ]) {
      if (!sides[key]) continue;
      const panel = {
        name,
        role: 'endPanel',
        material: 'front',
        length,
        width,
        thickness: et,
        edges: EDGES.l1(),
        bbox: box([x, -below, z0], [et, length, width]),
        ops: [],
      };
      if (notch) {
        const [nh, nd] = notch;
        panel.ops.push({ type: 'pocket', x: 0, y: 0, length: nh, width: nd, depth: et });
        panel.cuts = [box([x, -below, z0 + width - nd], [et, nh, nd])];
      }
      this.parts.push(panel);
    }
  }

  /**
   * Toe kick in the sides: the sides run down to the floor, notched at the
   * front for the toe kick (its height, back to the toe-kick board's face).
   * The case stays where it was, so everything drilled in the sides moves up
   * by the toe height from their new bottom edge.
   */
  sidesToFloor() {
    const { y0, d, t } = this;
    const setback = this.c.toeKickSetback;
    if (!(setback > 0 && setback < d - 50)) {
      throw new BuildError(`${this.spec.name}: base overhang must be between 0 and the depth less 50 mm for a toe kick in the sides`);
    }
    for (const side of [this.left, this.right]) {
      for (const op of side.ops) op.x += y0;
      side.length += y0;
      side.bbox = box([side.bbox.min[0], 0, 0], [t, side.bbox.size[1] + y0, d]);
      side.ops.push({ type: 'pocket', x: 0, y: 0, length: y0, width: setback, depth: t });
      side.cuts = [box([side.bbox.min[0], 0, d - setback], [t, y0, setback])];
    }
  }

  plinth() {
    const { t, w } = this;
    const h = this.c.toeKickHeight;
    const frontZ = this.d - this.c.toeKickSetback - t;
    const rail = (name, role, x, z, length, size) => ({
      name,
      role,
      material: 'case',
      length,
      width: h,
      thickness: t,
      edges: EDGES.none(),
      bbox: box([x, 0, z], size),
      ops: [],
    });
    if (this.c.plinth === 'board') {
      this.parts.push(rail('Toe kick', 'toeKick', 0, frontZ, w, [w, h, t]));
    } else if (this.c.plinth === 'sides') {
      // Between the sides, at the back of their toe-kick notches; the cover
      // goes over it and the notches.
      this.parts.push(rail('Toe kick', 'toeKick', t, frontZ, w - 2 * t, [w - 2 * t, h, t]));
      const cover = toeKickCover(this.spec, this.c, w, this.d, h);
      if (cover) this.parts.push(cover);
    } else {
      const end = frontZ - t;
      this.parts.push(
        rail('Plinth front', 'toeKick', 0, frontZ, w, [w, h, t]),
        rail('Plinth rear', 'plinthRear', 0, 0, w, [w, h, t]),
        rail('Plinth end', 'plinthEnd', 0, t, end, [t, h, end]),
        rail('Plinth end', 'plinthEnd', w - t, t, end, [t, h, end]),
      );
    }
  }

  back() {
    const { t, w, y0, caseH } = this;
    const bt = t;
    const depth = this.c.back.type === 'dado' ? this.c.back.depth : 0;
    const hasTop = this.spec.kind !== 'base';
    const y = y0 + t - depth;
    // Base: up to the top of the sides (butt joint under the stretchers);
    // wall/tall: into the top, dadoed like the bottom.
    const top = hasTop ? y0 + caseH - t + depth : y0 + caseH;
    const [width, height] = [w - 2 * t, top - y];

    if (depth > 0) {
      for (const p of this.parts.filter((p) => p.role === 'bottom' || p.role === 'top')) {
        p.ops.push({ type: 'pocket', x: 0, y: p.width - bt, length: p.length, width: bt, depth });
        // The dado is in the inside face: the top of the bottom, the underside of the top.
        const [px, py] = [p.bbox.min[0], p.bbox.min[1]];
        const dadoY = p.role === 'bottom' ? py + t - depth : py;
        p.cuts = [box([px, dadoY, 0], [p.bbox.size[0], depth, bt])];
      }
    }
    this.parts.push({
      name: 'Back',
      role: 'back',
      material: 'case',
      length: height,
      width,
      thickness: bt,
      edges: EDGES.none(),
      bbox: box([t, y, 0], [width, height, bt]),
      ops: [],
    });
  }

  /** Side-local x of every system-hole grid line in [lo, hi]. */
  gridLines(lo, hi) {
    const s = this.c.system;
    const out = [];
    for (let x = s.origin + Math.ceil((lo - s.origin) / s.spacing) * s.spacing; x <= hi + 1e-6; x += s.spacing) {
      out.push(x);
    }
    return out;
  }

  systemLineYs() {
    const s = this.c.system;
    const front = s.frontSetback;
    const ys = [front];
    if (s.rearLine) {
      const span = this.interiorDepth() - 2 * s.frontSetback;
      const rear = front + Math.floor(span / s.spacing) * s.spacing;
      if (rear > front + s.spacing) ys.push(rear);
    }
    return ys;
  }

  /**
   * Shelves in each door or open section (see fronts): its fixed shelves
   * evenly spaced, splitting it into bays that share its adjustable shelves
   * and get system holes. `lo` / `hi` are side-local.
   */
  shelves() {
    const t = this.t;
    for (const zone of this.shelfZones ?? []) {
      const fixed = Math.max(0, Math.round(zone.fixedShelves ?? 0));
      const bays = [];
      let lo = zone.lo;
      for (let i = 1; i <= fixed; i++) {
        const y = zone.lo + ((zone.hi - zone.lo) * i) / (fixed + 1) - t / 2;
        this.parts.push(this.divider('Fixed shelf', 'fixedShelf', this.y0 + y, 'panel'));
        bays.push([lo, y]);
        lo = y + t;
      }
      bays.push([lo, zone.hi]);
      // The adjustable shelves go to the bays from the top down.
      const n = Math.max(0, Math.round(zone.shelves ?? 0));
      bays.reverse().forEach(([lo, hi], i) => this.adjustableShelves(lo, hi, Math.floor(n / bays.length) + (i < n % bays.length ? 1 : 0)));
    }
  }

  /** `n` adjustable shelves on system holes between side-local `lo` and `hi`. */
  adjustableShelves(lo, hi, n) {
    if (n <= 0) return;
    const { t, c } = this;
    const s = c.system;
    const lines = this.gridLines(lo + s.endClearance, hi - s.endClearance);
    const ys = this.systemLineYs();
    for (const side of [this.left, this.right]) {
      for (const x of lines) for (const y of ys) addBore(side, x, y, s.diameter, s.depth, 'system');
    }
    if (hi - lo < 2 * t) return;
    const length = this.w - 2 * t - 2 * c.shelfSideClearance;
    const width = this.interiorDepth() - c.shelfFrontSetback;
    for (let i = 1; i <= n; i++) {
      const target = lo + ((hi - lo) * i) / (n + 1);
      const x = clamp(this.snap(target), lo, hi - t);
      this.parts.push({
        name: 'Adjustable shelf',
        role: 'shelf',
        material: 'case',
        length,
        width,
        thickness: t,
        edges: EDGES.l1(),
        bbox: box([t + c.shelfSideClearance, this.y0 + x, this.interiorZ0], [length, t, width]),
        ops: [],
      });
    }
  }

  /** A case panel between the sides with its underside at cabinet-space
   *  `y`: a front stretcher, or a full panel in front of the back. The side
   *  drawings dimension its centre (`divider`). */
  divider(name, role, y, kind) {
    const { t, w, d } = this;
    const depth = kind === 'stretcher' ? Math.min(this.c.stretcherWidth, d / 2) : d - this.interiorZ0;
    return {
      name,
      role,
      material: 'case',
      length: w - 2 * t,
      width: depth,
      thickness: t,
      edges: EDGES.l1(),
      bbox: box([t, y, d - depth], [w - 2 * t, t, depth]),
      ops: [],
      divider: true,
    };
  }

  /**
   * The front sections from the top down (see frontSections): sized ones
   * take their height, the rest share what is left; with none to fill it,
   * the space under the stack stays open. A stretcher or full panel under a
   * section sits behind the gap to the next. Door and open sections leave
   * shelf zones for shelves().
   */
  fronts() {
    const c = this.c;
    const r = c.reveals;
    const { t, y0: case0, caseH } = this;
    const name = this.spec.name;
    const [x0, x1] = [r.side, this.w - r.side];
    const [y0, y1] = [case0 + r.bottom, case0 + caseH - r.top];
    const sections = frontSections(this.spec);
    this.shelfZones = [];
    if (!sections.length) return;
    const sized = (sec) => (sec.units > 0 ? unitFrontHeight(c, sec.units) : sec.height > 0 ? sec.height : null);
    const fills = sections.filter((sec) => sized(sec) == null).length;
    const gaps = (sections.length - 1) * r.gap;
    const fixed = sections.reduce((n, sec) => n + (sized(sec) ?? 0), 0);
    const left = y1 - y0 - gaps - fixed;
    if (!fills && left < -1e-6) {
      if (sections.every((sec) => sec.units > 0)) {
        const total = sections.reduce((n, sec) => n + sec.units, 0);
        throw new BuildError(`${name}: the fronts take ${total} units of ${fmtMm(c.drawerUnit)} mm; the cabinet has room for ${frontUnits(c, this.spec)}`);
      }
      throw new BuildError(`${name}: the fronts take ${fmtLenU(fixed + gaps)}; the cabinet has ${fmtLen(y1 - y0)}`);
    }
    if (fills && left < 60 * fills) throw new BuildError(`${name}: the sized fronts leave no room for the others`);

    let top = y1;
    const placed = sections.map((sec) => {
      const fh = sized(sec) ?? left / fills;
      const p = { sec, top, bottom: top - fh };
      top -= fh + r.gap;
      return p;
    });
    // Dividers, centred on the gap under their section: [bottom, top] in cabinet space.
    placed.forEach((p, i) => {
      if (i === placed.length - 1 || !['stretcher', 'panel'].includes(p.sec.below)) return;
      const y = p.bottom - r.gap / 2 - t / 2;
      this.parts.push(this.divider(p.sec.below === 'stretcher' ? 'Stretcher' : 'Divider', p.sec.below === 'stretcher' ? 'frontStretcher' : 'fixedShelf', y, p.sec.below));
      p.divider = [y, y + t];
    });
    placed.forEach((p, i) => {
      const above = placed[i - 1]?.divider;
      const below = p.divider;
      const last = i === placed.length - 1;
      const { sec } = p;
      if (sec.type === 'drawer') {
        this.drawer(x0, x1, p.bottom, p.top, sec.units > 0 ? drawerSize(c, sec.units)?.box : undefined, {
          floor: below ? below[1] : case0 + t,
          ceiling: above ? above[0] - 5 : case0 + caseH - t - 5,
        });
        return;
      }
      if (sec.type === 'door') this.doors(x0, x1, p.bottom, p.top, sec.doors ?? 0);
      // Side-local: up to the divider above, or below the front above; down
      // to the divider below, or the front's bottom edge.
      const hi = i === 0 ? caseH - t : above ? above[0] - case0 : p.top - case0 - t;
      const lo = last ? t : below ? below[1] - case0 : p.bottom - case0;
      this.shelfZones.push({ lo, hi, shelves: sec.shelves, fixedShelves: sec.fixedShelves });
    });
  }

  doors(x0, x1, y0, y1, count) {
    const gap = this.c.reveals.gap;
    const n = count > 0 ? count : x1 - x0 > this.c.maxSingleDoorWidth ? 2 : 1;
    const dw = (x1 - x0 - (n - 1) * gap) / n;
    const dh = y1 - y0;
    if (dw < 100 || dh < 100) throw new BuildError(`${this.spec.name}: doors would be smaller than 100 mm`);
    const ft = thickness(this.c, 'front');
    const names = n === 1 ? ['Door'] : ['Left door', 'Right door'];
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (dw + gap);
      const hingeLeft = n === 1 || i < n / 2;
      const door = {
        name: names[i] ?? 'Door',
        role: 'door',
        material: 'front',
        length: dh,
        width: dw,
        thickness: ft,
        edges: EDGES.all(),
        bbox: box([x, y0, this.d], [dw, dh, ft]),
        ops: [],
      };
      const boring = this.hinges(door, hingeLeft);
      door.hinge = { name: this.c.hinge.name, count: hingeCount(dh), k: boring.k, cupCenter: boring.cupCenter, plate: boring.plate };
      this.parts.push(door);
    }
  }

  /** Hinge cups on the door and mounting plate holes on the side. Each
   *  hinge is centred between two grid lines so the plate's two screws,
   *  one spacing apart on the front system line, land on system holes.
   *  Returns the cup boring (see hingeBoring). */
  hinges(door, hingeLeft) {
    const h = this.c.hinge;
    const s = this.c.system;
    const boring = hingeBoring(this.c);
    const len = door.length;
    const n = hingeCount(len);
    const doorBottom = door.bbox.min[1] - this.y0; // in side-local x
    const [min, max] = [h.cupDiameter, len - h.cupDiameter];
    const cupY = hingeLeft ? boring.cupCenter : door.width - boring.cupCenter;
    const half = s.spacing / 2;
    for (let i = 0; i < n; i++) {
      const target = h.endOffset + ((len - 2 * h.endOffset) * i) / (n - 1);
      let sideX = this.snap(doorBottom + target - half) + half;
      while (sideX - doorBottom < min) sideX += s.spacing;
      while (sideX - doorBottom > max) sideX -= s.spacing;
      addBore(door, sideX - doorBottom, cupY, h.cupDiameter, h.cupDepth, 'hingeCup');
      const side = hingeLeft ? this.left : this.right;
      for (const x of [sideX - half, sideX + half]) {
        addBore(side, x, s.frontSetback, s.diameter, s.depth, 'hingePlate');
      }
    }
    return boring;
  }

  /** Slide screw holes in both sides for a slide whose base is at
   *  cabinet-space height `base`. */
  slideHoles(slideLength, base) {
    const sl = this.c.slide;
    const s = this.c.system;
    for (const side of [this.left, this.right]) {
      for (const z of sl.holes[slideLength] ?? []) {
        for (const ht of sl.holeHeights) addBore(side, base + ht - this.y0, z, s.diameter, s.depth, 'slide');
      }
    }
  }

  /** The job's slide length if the cabinet is deep enough, otherwise the
   *  longest available one that fits. */
  slideLength() {
    const sl = this.c.slide;
    const fits = (l) => l + sl.depthAllowance <= this.interiorDepth();
    if (fits(sl.length)) return sl.length;
    const shorter = sl.lengths.filter((l) => l < sl.length && fits(l));
    if (!shorter.length) throw new BuildError(`${this.spec.name}: too shallow for the shortest drawer slide`);
    return Math.max(...shorter);
  }

  /**
   * Drawer front plus an undermount drawer box. Sides run the full drawer
   * length; the bottom is raised for the slide runners and runs from the
   * front of the box to the back; the sub-front stands on the bottom and
   * the back runs down past it. Seen from the front, a 100 mm box in 16 mm
   * material is 12 (raise) + 16 (bottom) + 72 (sub-front); the back is 88.
   * `boxHeight` (from a drawer size) sets the side height; without it the
   * drawer gets the tallest side height that fits. Its slides stand on
   * `floor` (the case bottom, or a divider under it) and the box stays under
   * `ceiling`.
   */
  drawer(x0, x1, y0, y1, boxHeight, { floor = this.y0 + this.t, ceiling = this.y0 + this.caseH - this.t - 5 } = {}) {
    const c = this.c;
    const sl = c.slide;
    const name = this.spec.name;
    const fh = y1 - y0;
    if (fh < 60) throw new BuildError(`${name}: drawer fronts would be under 60 mm`);
    const front = {
      name: 'Drawer front',
      role: 'drawerFront',
      material: 'front',
      length: x1 - x0,
      width: fh,
      thickness: thickness(c, 'front'),
      edges: EDGES.all(),
      bbox: box([x0, y0, this.d], [x1 - x0, fh, thickness(c, 'front')]),
      ops: [],
    };
    this.parts.push(front);

    const t = this.t;
    // Drawer bottoms are cut from the drawer box material.
    const dt = thickness(c, 'drawerBox');
    if (dt > sl.maxSideThickness) {
      throw new BuildError(`${sl.name} slides take drawer material up to ${fmtMm(sl.maxSideThickness)} mm (drawer boxes are ${fmtMm(dt)} mm)`);
    }
    const slideLength = this.slideLength();
    // One pair of slides per drawer, recorded for the supply list.
    front.slide = { name: sl.name, length: slideLength };
    const length = slideLength - sl.drawerLengthDeduction;
    const inner = this.w - 2 * t - sl.insideWidthDeduction;
    const outer = inner + 2 * dt;
    const raise = c.drawerBottomRaise;
    // The drawer bottom rides on the runners: the lowest drawer's slides
    // stand on the cabinet bottom.
    const by = Math.max(y0 + 20, floor + sl.runnerHeight - raise);
    const room = Math.min(fh - c.drawerFrontClearance, ceiling - by);
    let bh;
    if (boxHeight > 0) {
      if (boxHeight > room + 1e-6) {
        throw new BuildError(`${name}: a ${fmtMm(boxHeight)} mm drawer box doesn't fit behind a ${fmtMm(fh)} mm front (up to ${fmtMm(Math.max(0, room))} mm)`);
      }
      bh = boxHeight;
    } else {
      const heights = c.drawerSideHeights.filter((ht) => ht <= room);
      if (!heights.length) {
        throw new BuildError(`${name}: a ${fmtMm(fh)} mm drawer front is too low for ${fmtMm(Math.min(...c.drawerSideHeights))} mm drawer sides`);
      }
      bh = Math.max(...heights);
    }
    // Top of the bottom, measured from the bottom edge of the sides.
    const onBottom = raise + dt;
    if (onBottom >= bh) throw new BuildError(`${name}: drawer sides are too low for the raised bottom`);
    const bx = (this.w - outer) / 2;
    const bz = this.d - length;

    const boxPart = (partName, role, partLength, width, bbox) => ({
      name: partName,
      role,
      material: 'drawerBox',
      length: partLength,
      width,
      thickness: dt,
      edges: EDGES.none(),
      bbox,
      ops: [],
    });
    this.parts.push(
      boxPart('Drawer side', 'drawerSide', length, bh, box([bx, by, bz], [dt, bh, length])),
      boxPart('Drawer side', 'drawerSide', length, bh, box([bx + outer - dt, by, bz], [dt, bh, length])),
      boxPart('Drawer sub-front', 'drawerSubFront', inner, bh - onBottom, box([bx + dt, by + onBottom, this.d - dt], [inner, bh - onBottom, dt])),
      boxPart('Drawer back', 'drawerBack', inner, bh - raise, box([bx + dt, by + raise, bz], [inner, bh - raise, dt])),
      boxPart('Drawer bottom', 'drawerBottom', inner, length - dt, box([bx + dt, by + raise, bz + dt], [inner, dt, length - dt])),
    );
    this.slideHoles(slideLength, by + raise - sl.runnerHeight);
  }
}
