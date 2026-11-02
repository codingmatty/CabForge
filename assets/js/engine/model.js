// Input model: what the user edits. Everything downstream (parts, boring,
// cut list) is derived from these values, so changing any one re-flows the
// whole job. All lengths are millimetres.

import { BAND_PARTS } from './part.js';
import { fmtMm } from './units.js';

export const CABINET_KINDS = {
  base: { label: 'Base', toeKick: true },
  wall: { label: 'Wall', toeKick: false },
  tall: { label: 'Tall', toeKick: true },
};

const KIND_DEFAULTS = {
  base: { width: 600, height: 880, depth: 610, elevation: 0, shelves: 1 },
  wall: { width: 600, height: 720, depth: 320, elevation: 1440, shelves: 2 },
  tall: { width: 600, height: 2160, depth: 610, elevation: 0, shelves: 4 },
};

// fronts: { type: 'stack', sections } — the cabinet's openings from the
// top down, each a door, a drawer or left open:
//   { type: 'door' | 'drawer' | 'open',
//     units?        front height in drawer units, or
//     height?       front height in mm; with neither it fills, sharing what
//                   the sized sections leave with the other filling ones,
//     doors         (door) 0 = automatic (a pair above maxSingleDoorWidth), 1 or 2,
//     shelves       (door, open) adjustable shelves,
//     fixedShelves  (door, open) fixed shelves, evenly spaced,
//     below         'none' | 'stretcher' | 'panel': what divides it from the
//                   section under it }
// Older jobs saved one of these, read as a stack by frontSections:
//   { type: 'open' }, { type: 'doors', count }, { type: 'drawers', count, units? },
//   { type: 'drawerOverDoors' | 'doorsOverDrawer', drawerHeight, doorCount, units? }
export const SECTION_TYPES = { door: 'Door', drawer: 'Drawer', open: 'Open' };
export const DIVIDERS = { none: 'Nothing', stretcher: 'Stretcher', panel: 'Full panel' };

/** A new section of `type` that fills its share of the cabinet. A drawer
 *  has a stretcher under it. */
export function newSection(type, shelves = 1) {
  if (type === 'drawer') return { type, below: 'stretcher' };
  return { type, ...(type === 'door' ? { doors: 0 } : {}), shelves, fixedShelves: 0, below: 'none' };
}

/** The cabinet's front sections, top to bottom (older front types read as a stack). */
export function frontSections(spec) {
  const f = spec.fronts ?? { type: 'open' };
  const shelves = spec.shelves ?? 0;
  const door = (doors) => ({ ...newSection('door', shelves), doors: doors ?? 0 });
  // Older drawers had nothing between them.
  const drawer = (size) => ({ ...newSection('drawer'), below: 'none', ...size });
  switch (f.type) {
    case 'stack':
      return f.sections ?? [];
    case 'doors':
      return [door(f.count)];
    case 'drawers':
      return f.units?.length ? f.units.map((units) => drawer({ units })) : Array.from({ length: Math.max(1, f.count) }, () => drawer({}));
    case 'drawerOverDoors':
    case 'doorsOverDrawer': {
      const d = drawer(f.units ? { units: f.units } : { height: f.drawerHeight });
      return f.type === 'drawerOverDoors' ? [d, door(f.doorCount)] : [door(f.doorCount), d];
    }
    default:
      return [{ ...newSection('open', shelves) }];
  }
}

/** The cabinet's fronts as a stack. */
export function stackFronts(spec) {
  return { type: 'stack', sections: JSON.parse(JSON.stringify(frontSections(spec))) };
}

/**
 * Size and placement for a new cabinet or filler of `kind`. With a job
 * construction `c`, width, depth and box height come from its New cabinet
 * sizes; the overall height adds the toe kick for floor-standing kinds.
 */
function kindDefaults(kind, c) {
  const d = KIND_DEFAULTS[kind];
  const size = c?.cabinetSizes?.[kind];
  if (!size) return d;
  const toe = CABINET_KINDS[kind].toeKick && c.plinth !== 'none' ? c.toeKickHeight : 0;
  return { ...d, width: size.width, height: size.boxHeight + toe, depth: size.depth };
}

export function newCabinet(kind, id = 0, c = null) {
  const d = kindDefaults(kind, c);
  return {
    id,
    name: `${CABINET_KINDS[kind].label} ${id}`,
    kind,
    width: d.width,
    // Overall height, including the plinth for base / tall cabinets.
    height: d.height,
    // Case depth, excluding fronts.
    depth: d.depth,
    // Left edge along the wall, and height of the cabinet's bottom above the floor.
    x: 0,
    elevation: d.elevation,
    shelves: d.shelves,
    fronts: { type: 'stack', sections: [newSection('door', d.shelves)] },
    // Finished end panels against the case sides.
    endPanels: { left: false, right: false },
  };
}

/** How deep the blind part of a blind corner's front is: the cabinets on
 *  the next wall (their depth and fronts) and the clearance for doors and
 *  pulls. */
export function blindDepth(c, kind) {
  const depth = c.cabinetSizes?.[kind]?.depth ?? KIND_DEFAULTS[kind].depth;
  return depth + frontProjection(c) + (c.blindClearance ?? 50.8);
}

/**
 * A blind corner cabinet for the end of a wall: a plain box that runs into
 * the corner, the cabinets on the next wall standing in front of its blind
 * end (`blind.width` from its right edge, covered by a wide stile or a
 * blind panel). The door takes the rest, `corner.openingA` wide.
 */
export function newBlindCorner(kind, id = 0, c = null) {
  const job = c ?? defaultConstruction();
  const spec = newCabinet(kind, id, c);
  const blind = Math.round(blindDepth(job, kind));
  const sec = { ...newSection('door', spec.shelves), doors: 1 };
  return { ...spec, name: `Blind corner ${kind} ${id}`, width: blind + (job.corner?.openingA ?? 300) + 2 * caseT(job), blind: { width: blind }, fronts: { type: 'stack', sections: [sec] } };
}

/** The run a cabinet, filler or space belongs to: 'base', 'wall' or 'tall'. */
export function runOf(spec) {
  return spec.kind === 'filler' || spec.kind === 'space' ? spec.run : spec.kind;
}

/** Thickness of the end panel on `side` ('left' | 'right') of a cabinet, 0 if none. */
export function endPanelThickness(jobConstruction, spec, side) {
  if (!spec.endPanels?.[side]) return 0;
  return thickness(effectiveConstruction(jobConstruction, spec.overrides), 'front');
}

/** Whether the cabinet or filler is floor-standing and can have a plinth. */
export function hasPlinth(spec) {
  return CABINET_KINDS[runOf(spec)].toeKick;
}

/** Height of the toe kick under the case: 0 for wall cabinets and when the
 *  base is 'none', so the case takes the full cabinet height. */
export function toeHeight(c, spec) {
  return hasPlinth(spec) && c.plinth !== 'none' ? c.toeKickHeight : 0;
}

/** Height of a front section `units` drawer units tall: the units less one
 *  separator (the gap, or a face frame's middle rail; see frontSpan). */
export function unitFrontHeight(c, units) {
  return units * c.drawerUnit - frontSep(c);
}

/** What separates two front sections under construction `c` (frontSpan). */
export function frontSep(c) {
  if (isFaceFrame(c)) return c.faceFrame.midRail;
  return c.cabinetStyle === 'framelessInset' ? c.insetGap : c.reveals.gap;
}

/** Whole drawer units that fit in the front space of cabinet `spec` (c is
 *  its effective construction). */
export function frontUnits(c, spec) {
  const { lo, hi, sep } = frontSpan(c, spec);
  return Math.floor((hi - lo + sep + 1e-6) / c.drawerUnit);
}

/** The drawer size row for `units`, if the construction lists one. */
export function drawerSize(c, units) {
  return c.drawerSizes.find((s) => s.units === units);
}

/** `count` drawers sharing `total` units, top to bottom: with three or more,
 *  a `top`-unit top drawer (0 = none) and the rest as even as they go, the
 *  extra units going to the bottom drawers (24 in 3 with a 5 top: 5, 9, 10). */
export function splitUnits(total, count, top = 0) {
  if (count >= 3 && top > 0 && total - top >= (count - 1) * top) return [top, ...splitUnits(total - top, count - 1)];
  const each = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => each + (i >= count - (total - each * count) ? 1 : 0));
}

/** The unit stack a new set of `count` drawers starts with in cabinet `spec`. */
export function defaultUnits(c, spec, count) {
  return splitUnits(frontUnits(c, spec), count, c.drawerTopUnits);
}

export const DEFAULT_FILLER_WIDTH = 50;

/** A filler strip between cabinets, sized like a cabinet of its run. */
export function newFiller(run, id = 0, c = null, width = DEFAULT_FILLER_WIDTH) {
  const d = kindDefaults(run, c);
  return {
    id,
    name: `Filler ${id}`,
    kind: 'filler',
    run,
    width,
    height: d.height,
    depth: d.depth,
    x: 0,
    elevation: d.elevation,
  };
}

/** A finished panel standing on its own in a run (beside a dishwasher, say):
 *  a filler built as an end panel, as wide as the front material is thick. */
export function newPanel(run, id = 0, c = null) {
  return { ...newFiller(run, id, c, panelWidth(c ?? defaultConstruction())), name: `Panel ${id}`, panel: true };
}

/** A standing panel's width: its front material's thickness. */
export function panelWidth(c) {
  return thickness(c, 'front');
}

// Spaces left in a run for an appliance: no parts, just room. `countertop`:
// whether a base run's countertop runs over it (a dishwasher) or stops (a range).
export const SPACE_PRESETS = {
  space: { label: 'Space', run: 'base', width: 600, countertop: true },
  dishwasher: { label: 'Dishwasher', run: 'base', width: 610, countertop: true },
  range: { label: 'Range', run: 'base', width: 762, countertop: false },
  fridge: { label: 'Fridge', run: 'tall', width: 914, countertop: false },
};

/** The size a new space of `preset` starts at: the job's spaceSizes (a 0
 *  height or depth takes its run's), else the preset's width and its run's
 *  height and depth. */
export function spaceSize(preset, c = null) {
  const sp = SPACE_PRESETS[preset];
  const d = kindDefaults(sp.run, c);
  const own = c?.spaceSizes?.[preset] ?? {};
  return { width: own.width || sp.width, height: own.height || d.height, depth: own.depth || d.depth };
}

/** A space in a run (see SPACE_PRESETS), sized as spaceSize says. */
export function newSpace(preset = 'space', id = 0, c = null) {
  const sp = SPACE_PRESETS[preset];
  const d = kindDefaults(sp.run, c);
  const size = spaceSize(preset, c);
  return {
    id,
    name: `${sp.label} ${id}`,
    kind: 'space',
    preset,
    run: sp.run,
    width: size.width,
    height: size.height,
    depth: size.depth,
    x: 0,
    elevation: d.elevation,
    countertop: sp.countertop,
  };
}

/** A base cabinet with `drawers` drawers, their fronts in drawer units
 *  (see defaultUnits). */
export function drawerBase(id = 0, drawers = 3, c = null) {
  const spec = { ...newCabinet('base', id, c), name: `Drawer base ${id}`, shelves: 0 };
  const units = defaultUnits(c ?? defaultConstruction(), spec, drawers);
  return { ...spec, fronts: { type: 'stack', sections: units.map((u) => ({ ...newSection('drawer'), units: u })) } };
}

// 'Edge band' marks a roll of edge banding rather than sheet stock.
export const EDGE_BAND_KIND = 'Edge band';
export const MATERIAL_KINDS = ['Melamine', 'MDF', 'Plywood', 'Particleboard', 'Solid wood', 'Other', EDGE_BAND_KIND];

const INCH = 25.4;
/** Stock sheet sizes: 49" x 97" for melamine, 48" x 96" for everything else. */
export function defaultSheetSize(kind) {
  return kind === 'Melamine' ? [97 * INCH, 49 * INCH] : [96 * INCH, 48 * INCH];
}

/**
 * US standard sizes for new cabinets (in place): 24" wide, 34 1/2" base with
 * a 4" toe kick, 30" wall, 84" tall, 24" deep with the door, 12" deep walls;
 * a 24" dishwasher, 30" range, 36" fridge; 24" corner walls; a 1 1/2" top
 * with a 1" overhang. Doors up to 24" stay single. Materials, reveals and
 * hardware are left alone. Cabinets already in a job keep their sizes.
 */
export function usStandardSizes(c) {
  const toe = 4 * INCH;
  const caseDepth = 23.25 * INCH; // 24" with a 3/4" door
  c.toeKickHeight = toe;
  c.toeKickSetback = 3 * INCH;
  c.cabinetSizes = {
    base: { width: 24 * INCH, boxHeight: 34.5 * INCH - toe, depth: caseDepth },
    wall: { width: 24 * INCH, boxHeight: 30 * INCH, depth: 11.25 * INCH },
    tall: { width: 24 * INCH, boxHeight: 84 * INCH - toe, depth: caseDepth },
  };
  c.maxSingleDoorWidth = 24 * INCH;
  c.spaceSizes = {
    space: { width: 24 * INCH, height: 0, depth: 0 },
    dishwasher: { width: 24 * INCH, height: 0, depth: 0 },
    range: { width: 30 * INCH, height: 0, depth: 0 },
    fridge: { width: 36 * INCH, height: 70 * INCH, depth: 0 },
  };
  c.corner = { ...c.corner, baseDepth: caseDepth, openingA: 12 * INCH, openingB: 12 * INCH, wallSize: 24 * INCH };
  c.countertop = { ...c.countertop, thickness: 1.5 * INCH, frontOverhang: 1 * INCH };
  return c;
}

/** A library material. An edge band (kind 'Edge band', `edgeBand` true) is a
 *  roll of banding: its thickness is the band thickness and it has no sheet
 *  size. `cost` is the price of a sheet, or of a metre of band; 0 = not priced. */
export function newMaterial(id, name, kind, thickness, color) {
  const [sheetLength, sheetWidth] = defaultSheetSize(kind);
  return { id, name, kind, thickness, color, sheetLength, sheetWidth, grain: false, edgeBand: kind === EDGE_BAND_KIND, cost: 0 };
}

/** "$1,234.50" */
export function fmtMoney(v) {
  return `$${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Millimetres with no unit (units.js formats lengths in the display units).
export { fmtMm };

/** "White melamine 16mm" */
export function materialLabel(m) {
  return `${m.name} ${fmtMm(m.thickness)}mm`;
}

// What a part is cut from. The back uses the case material and drawer
// bottoms the drawer box material; shaker fronts' center panels the panel
// material.
export const SLOTS = ['case', 'front', 'drawerBox', 'panel'];
export const SLOT_LABELS = { case: 'Case', front: 'Fronts', drawerBox: 'Drawer boxes', panel: 'Door panels' };

// How doors and drawer fronts are made (see shakerFronts in build.js).
export const FRONT_STYLES = { slab: 'Slab', shaker: 'Shaker (2-piece)' };
// The center panel material a library starts with: 1/4" MDF.
const PANEL_MATERIAL_NAME = 'MDF 1/4″';
const PANEL_THICKNESS = 6.35;

// ---- cabinet styles ----------------------------------------------------------

export const CABINET_STYLES = {
  frameless: 'Frameless, overlay fronts',
  framelessInset: 'Frameless, inset fronts',
  faceFrameInset: 'Face frame, inset fronts',
  faceFrameOverlay: 'Face frame, overlay fronts',
};
export const JOINERY = { pocket: 'Pocket screws', mortise: 'Mortise & tenon', dowel: 'Dowels / dominos' };

export const isFaceFrame = (c) => c.cabinetStyle === 'faceFrameInset' || c.cabinetStyle === 'faceFrameOverlay';
export const isInset = (c) => c.cabinetStyle === 'framelessInset' || c.cabinetStyle === 'faceFrameInset';

/** The face-frame wood (woods list) for construction `c`. */
export function frameWood(c) {
  return c.woods?.find((w) => w.id === c.faceFrame?.wood) ?? c.woods?.[0] ?? null;
}

/** Face frame thickness: its wood's (3/4" without one). */
export function frameThickness(c) {
  return frameWood(c)?.thickness || 19.05;
}

/** How far the front of the fronts stands in front of the case: the
 *  front thickness (frameless overlay), the frame (face frame inset), the
 *  frame and the front (face frame overlay) or nothing (frameless inset). */
export function frontProjection(c) {
  const ft = thickness(c, 'front');
  switch (c.cabinetStyle) {
    case 'framelessInset':
      return 0;
    case 'faceFrameInset':
      return Math.max(frameThickness(c), ft);
    case 'faceFrameOverlay':
      return frameThickness(c) + ft;
    default:
      return ft;
  }
}

// Hinge catalogues for the inset and face-frame styles. The numbers are from
// the makers' and dealers' published listings (35 mm cups; Blum cups 13
// deep, Salice about 11; boring distance 3 mm, 2.5 for the Salice 1/2"
// face-frame hinge): check them against the instructions that come with the
// hinges before boring doors.
export const HINGE_BRANDS = { blum: 'Blum', salice: 'Salice' };
const BRAND_HINGES = {
  blum: {
    framelessInset: { name: 'Blum CLIP top BLUMOTION 110° inset (71B3790)', cupDepth: 13, k: 3 },
    faceFrameInset: { name: 'Blum CLIP top BLUMOTION 110° inset (71B3790), face-frame plate', cupDepth: 13, k: 3 },
    faceFrameOverlay: { name: 'Blum Compact 38N 1/2″ overlay face-frame hinge', cupDepth: 13, k: 3 },
  },
  salice: {
    framelessInset: { name: 'Salice Silentia 105° inset (C1R6PD9)', cupDepth: 11.5, k: 3 },
    faceFrameInset: { name: 'Salice Silentia 105° inset (C1R6PD9), face-frame plate', cupDepth: 11.5, k: 3 },
    faceFrameOverlay: { name: 'Salice Excenthree 1/2″ overlay face-frame hinge (CSP37XR)', cupDepth: 11, k: 2.5 },
  },
};
export const HINGE_TYPES = { euro: 'Concealed (35 mm cup)', butt: 'Butt / knife (mortised)' };

/** Hinges for each inset and face-frame style from `brand`'s catalogue. */
export function hingePreset(brand) {
  const out = {};
  for (const [style, h] of Object.entries(BRAND_HINGES[brand] ?? BRAND_HINGES.blum)) {
    out[style] = {
      type: 'euro',
      ...h,
      cupDiameter: 35,
      endOffset: 100,
      cost: 0,
      plateCost: 0,
      // Butt or knife hinges (type 'butt'): leaf length and price.
      buttName: '2 1/2″ butt hinge',
      buttLength: 63.5,
      buttCost: 0,
    };
  }
  return out;
}

/** Fills the style hinges in from `brand`, keeping each style's hinge type
 *  and butt hinge (in place). */
export function applyHingeBrand(c, brand) {
  const preset = hingePreset(brand);
  for (const [style, h] of Object.entries(preset)) {
    const old = c.styleHinges?.[style] ?? {};
    preset[style] = { ...h, type: old.type ?? h.type, buttName: old.buttName ?? h.buttName, buttLength: old.buttLength ?? h.buttLength, buttCost: old.buttCost ?? h.buttCost, cost: old.cost ?? 0, plateCost: old.plateCost ?? 0 };
  }
  c.hingeBrand = brand;
  c.styleHinges = preset;
  return c;
}

/** The hinge doors use under construction `c`: the style's, or null for
 *  frameless overlay (which uses c.hinge). */
export function styleHinge(c) {
  return c.cabinetStyle === 'frameless' ? null : c.styleHinges?.[c.cabinetStyle] ?? null;
}

/**
 * Where the fronts of a cabinet go, in cabinet-space heights: `lo`..`hi` is
 * the span the sections share and `sep` what separates two of them (the
 * gap, or a face frame's middle rail); a section n drawer units tall takes
 * n × drawerUnit less one `sep` (frontCell). For a face frame these are
 * the frame openings, for the other styles the fronts themselves (an inset
 * front is the cell less the gap all round).
 */
export function frontSpan(c, spec) {
  const y0 = toeHeight(c, spec);
  const top = spec.height;
  const t = caseT(c);
  const r = c.reveals;
  switch (c.cabinetStyle) {
    case 'framelessInset':
      return { lo: y0 + t + c.insetGap, hi: top - t - c.insetGap, sep: c.insetGap };
    case 'faceFrameInset':
    case 'faceFrameOverlay': {
      const ff = c.faceFrame;
      return { lo: y0 + ff.bottomRail, hi: top - ff.topRail, sep: ff.midRail };
    }
    default:
      return { lo: y0 + r.bottom, hi: top - r.top, sep: r.gap };
  }
}

/** Job-wide construction standards, including the material library. */
export function defaultConstruction() {
  return {
    library: [
      newMaterial(1, 'White melamine', 'Melamine', 16, '#f2f1ec'),
      newMaterial(2, 'Painted MDF', 'MDF', 19, '#c9d3df'),
      newMaterial(3, 'Baltic birch', 'Plywood', 12, '#e2c597'),
      { ...newMaterial(4, 'White PVC', EDGE_BAND_KIND, 1, '#f7f6f2'), bandType: 'PVC' },
      newMaterial(5, PANEL_MATERIAL_NAME, 'MDF', PANEL_THICKNESS, '#c9d3df'),
    ],
    // Library material id for each slot.
    materials: { case: 1, front: 2, drawerBox: 3, panel: 5 },
    // The kinds of edge band the shop uses; each edge band material is one of them.
    edgeBandTypes: ['PVC', 'ABS', 'Wood veneer', 'Melamine', 'Acrylic'],
    // Edge band (an edgeBand library material) for the parts cut from each
    // slot. Each part type's own band (partBands, filled in by ensureBands)
    // starts from these.
    bands: { case: 4, front: 4, drawerBox: 4, panel: 4 },
    // The back fits between the sides, rear face flush with the rear of the
    // case: { type: 'butt' } stands on the bottom, { type: 'dado', depth }
    // is let into a dado across the bottom.
    back: { type: 'butt' },
    // 32mm system: hole lines frontSetback from the front edge, holes every
    // spacing from origin above the bottom of the side.
    system: {
      frontSetback: 37,
      spacing: 32,
      diameter: 5,
      depth: 12,
      origin: 8,
      rearLine: true,
      endClearance: 48,
    },
    reveals: { side: 1.5, top: 1.5, bottom: 0, gap: 3 },
    // Richelieu RCS 322 105° clip-on hinge, full overlay: 35mm cup 11.5 deep,
    // doors 14–22 thick. The mounting plate screws into two holes on the
    // system line, one system spacing apart and centred on the hinge.
    hinge: {
      name: 'Richelieu RCS 322 105° clip-on hinge',
      cupDiameter: 35,
      cupDepth: 11.5,
      // Boring distance K: door edge to the edge of the cup, so the cup
      // centre is K + cupDiameter / 2 from the edge. 'auto' picks K from the
      // door thickness and overlay (k is the preferred value); 'manual'
      // drills every door at k.
      boring: 'auto',
      k: 5,
      kRange: [3, 7],
      doorThickness: [14, 22],
      // Plate heights available. At the factory setting the overlay is
      // armOffset + K - plate height.
      plateHeights: [0, 2, 4],
      armOffset: 12,
      // Gap between the closed door and the case front, plate on the 37 line.
      doorGap: 1.5,
      // From the RCS 322 instructions: rows K = 3..7, columns door
      // thickness 14..22. The side reveal and door gap the door needs to
      // swing open.
      minReveal: [
        [0.3, 0.5, 0.7, 0.9, 1.2, 1.5, 1.8, 2.2, 2.6],
        [0.3, 0.5, 0.7, 0.9, 1.1, 1.4, 1.8, 2.1, 2.5],
        [0.2, 0.4, 0.6, 0.9, 1.1, 1.4, 1.7, 2.0, 2.4],
        [0.2, 0.4, 0.6, 0.8, 1.1, 1.3, 1.6, 2.0, 2.4],
        [0.2, 0.4, 0.5, 0.8, 1.0, 1.3, 1.6, 1.9, 2.3],
      ],
      minDoorGap: [
        [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.2],
        [1.0, 1.0, 1.0, 1.0, 1.0, 1.3, 1.5, 1.8, 2.0],
        [1.0, 1.3, 1.5, 1.8, 2.0, 2.3, 2.5, 2.8, 3.0],
        [2.0, 2.3, 2.5, 2.7, 3.0, 3.2, 3.5, 3.7, 3.9],
      ],
      endOffset: 100,
      // Prices for the Materials report (0 = not priced).
      cost: 0,
      plateCost: 0,
    },
    // Band thickness when a slot's edge band is missing from the library.
    edgeBandThickness: 1,
    // Banded edges per part type (see BAND_PARTS in part.js).
    edgeBanding: {
      side: { l1: true, l2: false, w1: false, w2: false },
      bottomTop: { l1: true, l2: false, w1: false, w2: false },
      frontStretcher: { l1: true, l2: false, w1: false, w2: false },
      rearStretcher: { l1: false, l2: false, w1: false, w2: false },
      shelf: { l1: true, l2: false, w1: false, w2: false },
      back: { l1: false, l2: false, w1: false, w2: false },
      door: { l1: true, l2: true, w1: true, w2: true },
      drawerFront: { l1: true, l2: true, w1: true, w2: true },
      endPanel: { l1: true, l2: false, w1: false, w2: false },
      filler: { l1: true, l2: true, w1: false, w2: false },
      plinth: { l1: false, l2: false, w1: false, w2: false },
      drawerBox: { l1: false, l2: false, w1: false, w2: false },
    },
    // 'frame' (front/rear rails + ends), 'board' (single toe kick), 'sides'
    // (the sides run to the floor, notched for a toe kick between them) or
    // 'none' (no toe kick: the case stands on the floor at the full cabinet
    // height).
    plinth: 'frame',
    toeKickHeight: 110,
    // How far the case overhangs the front of the plinth.
    toeKickSetback: 60,
    // Integrated toe kick ('sides'): a cover strip of front material over
    // the toe-kick board and the sides' notches, like a filler.
    toeKickCover: true,
    // Sizes new spaces start at (0: the height or depth of their run).
    spaceSizes: {
      space: { width: 600, height: 0, depth: 0 },
      dishwasher: { width: 610, height: 0, depth: 0 },
      range: { width: 762, height: 0, depth: 0 },
      // A fridge with room for a cabinet over it.
      fridge: { width: 914, height: 1780, depth: 0 },
    },
    stretcherWidth: 120,
    shelfSideClearance: 1,
    shelfFrontSetback: 10,
    maxSingleDoorWidth: 600,
    // 'slab' or 'shaker': a 2-piece shaker front is a frame cut from the
    // front material (its opening cut through, a rabbet around the opening
    // on the back, as deep as the panel material is thick) and a center
    // panel of the panel material dropped into the rabbet. frame: stile and
    // rail width (2 1/4"); rabbet: how far the rabbet runs under the frame;
    // clearance: play around the panel on each side; fronts whose opening
    // would be under minOpening either way stay slab.
    frontStyle: 'slab',
    shaker: { frame: 57.15, rabbet: 2, clearance: 0.5, minOpening: 60 },
    // How the case and fronts go together (see CABINET_STYLES): frameless
    // with overlay fronts, frameless inset, or a solid wood face frame with
    // inset or overlay fronts. Any cabinet can override it.
    cabinetStyle: 'frameless',
    // Gap all round an inset front (3/32"), and how far a front laps onto
    // a face frame (1/2"). Between two fronts on one rail, each laps half
    // of what the rail leaves after the gap.
    insetGap: 2.38125,
    frameOverlay: 12.7,
    // Face frames: stiles flush with the inside of the case, so a stile
    // between two cases is both their sides wide (more over a filler), and
    // one at the end of a run is a side plus the scribe. Rails run between
    // the stiles; the bottom rail's top is flush with the top of the case
    // bottom, which is raised to meet it. `continuous`: one frame along a
    // run of cabinets with a shared stile at each joint (false: a frame per
    // cabinet). Joints: 'pocket' screws, 'mortise' and tenon (rails `tenon`
    // longer at each end) or 'dowel' (`dowels` per joint, `dowelDiameter`).
    // `wood`: the solid wood (woods list) the frames are cut from.
    faceFrame: {
      topRail: 38.1,
      bottomRail: 38.1,
      midRail: 25.4,
      scribe: 6.35,
      continuous: true,
      joinery: 'pocket',
      tenon: 25.4,
      dowels: 2,
      dowelDiameter: 9.525,
      wood: 1,
    },
    // Solid wood for face frames: finished thickness, rough stock in
    // quarters (4 = 4/4) for board feet, price per board foot, waste %.
    woods: [
      { id: 1, name: 'Hard maple', thickness: 19.05, quarters: 4, cost: 0, waste: 20, color: '#e8d2a6' },
      { id: 2, name: 'Poplar (paint grade)', thickness: 19.05, quarters: 4, cost: 0, waste: 20, color: '#d9d4b0' },
    ],
    // Hinges for the inset and face-frame styles (frameless overlay uses
    // `hinge`). `hingeBrand` is the catalogue they were filled in from
    // (HINGE_BRANDS); each can then be edited. `type`: 'euro' (35 mm cup
    // bored `k` from the door edge) or 'butt' (mortised butt or knife
    // hinges: positions only, nothing bored).
    hingeBrand: 'blum',
    styleHinges: hingePreset('blum'),
    // Blind corner cabinets: the blind part of the front is the depth of the
    // cabinets on the next wall, their fronts, and this clearance for the
    // doors and pulls.
    blindClearance: 50.8,
    // Sizes for cabinets added to a job. boxHeight is the case alone: base
    // and tall cabinets stand on the toe kick, which adds to the overall
    // height (768 + 110 = 878 for a base).
    cabinetSizes: {
      base: { width: 600, boxHeight: 768, depth: 610 },
      wall: { width: 600, boxHeight: 720, depth: 320 },
      tall: { width: 600, boxHeight: 2050, depth: 610 },
    },
    // Finished end panels, cut from the front material. Deeper and taller
    // than the case so they can be scribed to the wall and floor: a 610 deep,
    // 880 high base gets a 645 x 890 panel with a 55 x 120 toe-kick notch.
    endPanel: {
      frontOverhang: 22,
      rearScribe: 13,
      // Floor-standing cabinets only.
      floorScribe: 10,
      // Notch for the toe kick (base height + floor scribe high).
      toeKick: true,
      toeKickDepth: 55,
    },
    // Undermount slide. Defaults are the Richelieu 818 EVOLUTION installation
    // dimensions for 16mm drawer material in frameless cabinets.
    slide: {
      name: 'Richelieu 818 EVOLUTION undermount',
      // Nominal lengths available; `length` is the one drawers use when the
      // cabinet is deep enough (shorter ones are picked automatically).
      lengths: [270, 300, 350, 400, 450, 500, 550],
      length: 550,
      // Drawer length = slide length - this.
      drawerLengthDeduction: 10,
      // Cabinet inside depth must be at least slide length + this.
      depthAllowance: 3,
      // Drawer inside width = cabinet inside width - this.
      insideWidthDeduction: 42,
      maxSideThickness: 16,
      // Underside of the drawer bottom above the base of the slide (the
      // cabinet bottom for the lowest drawer).
      runnerHeight: 28,
      // Cabinet-side screw holes: two rows this high above the base of the
      // slide, at these distances from the front edge of the case for each
      // slide length.
      holeHeights: [26, 38],
      // Price of a pair of slides for the Materials report (0 = not priced).
      cost: 0,
      holes: {
        270: [37, 69, 165, 197],
        300: [37, 69, 165, 197],
        350: [37, 69, 165, 229],
        400: [37, 69, 165, 229],
        450: [37, 69, 165, 261],
        500: [37, 69, 165, 261, 284],
        550: [37, 69, 165, 261, 284, 339],
      },
    },
    // Drawer box side heights available; each drawer gets the tallest one
    // that fits under its front (front height - drawerFrontClearance).
    drawerSideHeights: [100, 200],
    drawerFrontClearance: 50,
    // Drawer fronts sized in units: a front n units tall is n × drawerUnit
    // less one gap (5 units = 157 with a 3 mm gap), so a stack lines up with
    // the 32 mm grid. Each size names the drawer box (side height) it takes.
    // New corner cabinets (see corner.js): the base L corner's depth and its
    // two door openings, the wall diagonal corner's legs, and the 45° cut
    // across the back corner along each wall.
    corner: { baseDepth: 590, openingA: 300, openingB: 300, wallSize: 600, chamfer: 50 },
    // A continuous countertop over each run of base cabinets (3D view and
    // Materials report only): front overhang past the doors, end overhang
    // at both ends of a run, price per metre of length (0 = not priced).
    // Paint (Materials report only): the products, each its coats, coverage
    // (ft² per container) and price per container, bought in whole ones; and
    // which part faces and edges are painted (see paint.js).
    paint: {
      enabled: true,
      products: [
        { name: 'Sealer', coats: 1, coverage: 350, unit: 'gal', cost: 99 },
        { name: 'Primer', coats: 2, coverage: 350, unit: 'gal', cost: 99 },
        { name: 'Top coat', coats: 3, coverage: 350, unit: 'gal', cost: 131 },
      ],
      parts: {
        fronts: { faces: 2, edges: true },
        fillers: { faces: 1, edges: true },
        endPanels: { faces: 1, edges: true },
        panels: { faces: 2, edges: true },
        sides: { faces: 0, edges: false },
        shelves: { faces: 0, edges: false },
        plinth: { faces: 0, edges: false },
        kickCovers: { faces: 1, edges: true },
        frames: { faces: 1, edges: true },
      },
    },
    countertop: { enabled: true, name: 'Countertop', thickness: 30, frontOverhang: 25, endOverhang: 0, color: '#8b8f96', cost: 0 },
    drawerUnit: 32,
    // New stacks of three or more drawers: the top drawer's units (0 = all equal).
    drawerTopUnits: 5,
    drawerSizes: [
      { units: 5, box: 100 },
      { units: 6, box: 100 },
      { units: 7, box: 100 },
      { units: 8, box: 200 },
      { units: 9, box: 200 },
      { units: 10, box: 200 },
      { units: 11, box: 200 },
      { units: 12, box: 200 },
    ],
    // Height of the underside of the drawer bottom above the bottom edge of
    // the sides (room for the slide runners; 818 EVOLUTION allows max 13).
    drawerBottomRaise: 12,
    // Sheet nesting: saw kerf between parts and trim around each sheet edge.
    // mode: 'cnc' (free nesting) or 'saw' (guillotine cuts for a panel saw);
    // effort: 'quick' | 'normal' | 'thorough'; group: lay same-size parts
    // out in strips when that costs no extra sheet.
    nesting: { kerf: 4, trim: 10, mode: 'cnc', effort: 'normal', group: true },
    // CNC router (GRBL, Z0 on top of the material, X0 Y0 at the front-left
    // corner of the stock). One end mill both drills and cuts the parts out.
    cnc: {
      // 49" x 49" table; the stock on it is what the parts are nested on.
      tableX: 1244.6,
      tableY: 1244.6,
      stockX: 1244.6,
      stockY: 1244.6,
      // Stock edge to the nearest part, and between parts. Both must leave
      // room for the tool and the lead-in arc.
      margin: 8,
      spacing: 8,
      toolDiameter: 5,
      rpm: 18000,
      // mm/min. The rapid rate is only used to estimate run times.
      feed: 2500,
      plungeFeed: 600,
      rapidFeed: 5000,
      passDepth: 6,
      // Holes bigger than the tool are bored in a helix, this deep per turn.
      helixPitch: 2,
      // Peck drilling for holes the tool's size: pecks this deep, retracting
      // after each to the clearance height ('full', clears the chips) or just
      // chipBreak back up ('chip').
      peckDrill: false,
      peck: 3,
      peckRetract: 'full',
      chipBreak: 0.5,
      // How far the cut-out goes below the material, into the spoilboard.
      cutThrough: 0.3,
      safeZ: 15,
      clearZ: 3,
      spindleDelay: 3,
      // 'climb' or 'conventional'.
      direction: 'climb',
      // Operations, and how parts are held and entered.
      drill: true,
      // Dadoes and rabbets (the back's), cleared from the top this percentage
      // of the tool apart. Through notches always shape the cut-out.
      pockets: true,
      stepover: 40,
      profile: true,
      tabs: true,
      // 'triangle' (ramps up and down, easier on the end mill) or 'square'.
      tabShape: 'triangle',
      tabLength: 8,
      tabHeight: 2,
      // About one tab per this much perimeter, at least two per part.
      tabSpacing: 400,
      // Ramp down along the outline instead of plunging, over this length.
      ramp: true,
      rampLength: 60,
      // A tangent arc onto and off the outline, this far outside it.
      leadIn: true,
      leadInRadius: 2,
    },
  };
}

export function materialById(c, id) {
  return c.library.find((m) => m.id === id) ?? null;
}

export function material(c, slot) {
  return materialById(c, c.materials[slot]);
}

/** The material a built part is cut from (parts record the library id). */
export function partMaterial(c, part) {
  return materialById(c, part.materialId ?? c.materials[part.material]);
}

/** What a part is made from for showing it: its sheet material, or for a
 *  face frame part its solid wood ({ name, color, thickness, kind }). */
export function partStock(c, part) {
  if (!part.solid) return partMaterial(c, part);
  const w = c.woods?.find((x) => x.id === part.woodId) ?? frameWood(c);
  return w ? { ...w, kind: 'Solid wood' } : null;
}

/** Thickness of the material in `slot` (0 if missing from the library). */
export function thickness(c, slot) {
  return material(c, slot)?.thickness ?? 0;
}

/** The edge band material for parts cut from `slot`. */
export function bandMaterial(c, slot) {
  const m = materialById(c, c.bands?.[slot]);
  return m?.edgeBand ? m : null;
}

/** Thickness of the band on a built part's banded edges (parts record the band id). */
export function bandThickness(c, part) {
  const m = materialById(c, part.bandId ?? c.bands?.[part.material]);
  return m?.edgeBand ? m.thickness : c.edgeBandThickness ?? 0;
}

/**
 * Makes sure every slot has an edge band from the library. Saves from before
 * edge band materials get one made from their band thickness.
 */
export function ensureBands(c) {
  // The type decides: an 'Edge band' material is a band, nothing else is.
  c.edgeBandTypes = Array.isArray(c.edgeBandTypes) && c.edgeBandTypes.length ? c.edgeBandTypes : defaultConstruction().edgeBandTypes;
  for (const m of c.library) {
    if (m.edgeBand && m.kind !== EDGE_BAND_KIND) m.kind = EDGE_BAND_KIND;
    m.edgeBand = m.kind === EDGE_BAND_KIND;
    // Every band has a type from the list; a type the list lost is put back.
    if (m.edgeBand) {
      m.bandType ||= c.edgeBandTypes[0];
      if (!c.edgeBandTypes.includes(m.bandType)) c.edgeBandTypes.push(m.bandType);
    }
  }
  const isBand = (id) => !!materialById(c, id)?.edgeBand;
  if (!SLOTS.every((s) => isBand(c.bands?.[s]))) {
    let band = c.library.find((m) => m.edgeBand);
    if (!band) {
      band = { ...newMaterial(nextMaterialId(c), 'Edge band', EDGE_BAND_KIND, c.edgeBandThickness ?? 1, '#f7f6f2'), bandType: c.edgeBandTypes[0] };
      c.library.push(band);
    }
    c.bands = Object.fromEntries(SLOTS.map((s) => [s, isBand(c.bands?.[s]) ? c.bands[s] : band.id]));
  }
  // Each part type picks its band; missing ones start from their material's.
  c.partBands = Object.fromEntries(
    Object.entries(BAND_PARTS).map(([group, { slot }]) => [group, isBand(c.partBands?.[group]) ? c.partBands[group] : c.bands[slot]]),
  );
}

/**
 * Makes sure the panel slot names a sheet material. Saves from before
 * shaker fronts get a 1/4" MDF from their library, or a new one.
 */
export function ensurePanelMaterial(c) {
  const current = materialById(c, c.materials.panel);
  if (current && !current.edgeBand) return;
  let m = c.library.find((m) => !m.edgeBand && m.kind === 'MDF' && Math.abs(m.thickness - PANEL_THICKNESS) < 0.5);
  if (!m) {
    m = newMaterial(nextMaterialId(c), PANEL_MATERIAL_NAME, 'MDF', PANEL_THICKNESS, material(c, 'front')?.color ?? '#c9d3df');
    c.library.push(m);
  }
  c.materials.panel = m.id;
}

/** The band a part type uses (its material's band when not set). */
export function partBandId(c, group, slot) {
  return c.partBands?.[group] ?? c.bands?.[slot] ?? null;
}

/** "White PVC 1mm · PVC" for a band, the plain label otherwise. */
export function bandLabel(m) {
  return m.bandType ? `${materialLabel(m)} · ${m.bandType}` : materialLabel(m);
}

export function caseT(c) {
  return thickness(c, 'case');
}

export function nextMaterialId(c) {
  return c.library.reduce((max, m) => Math.max(max, m.id), 0) + 1;
}

// ---- per-cabinet construction overrides ------------------------------------
//
// A cabinet's `overrides` is a partial construction object (e.g.
// { materials: { case: 4 }, toeKickHeight: 100 }) laid over the job's
// construction. Objects with a `type` (such as `back`) are replaced whole.

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function mergeDeep(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) && !('type' in v) ? mergeDeep(base[k], v) : v;
  }
  return out;
}

/** The construction one cabinet is built with. */
export function effectiveConstruction(c, overrides) {
  return overrides && Object.keys(overrides).length ? mergeDeep(c, overrides) : c;
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function hasPath(obj, path) {
  return getPath(obj, path) !== undefined;
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let o = obj;
  for (const k of keys) o = isPlainObject(o[k]) ? o[k] : (o[k] = {});
  o[last] = value;
}

/** Removes a value and any objects the removal leaves empty. */
export function deletePath(obj, path) {
  const keys = path.split('.');
  const trail = [obj];
  for (const k of keys.slice(0, -1)) {
    const next = trail[trail.length - 1]?.[k];
    if (!isPlainObject(next)) return;
    trail.push(next);
  }
  delete trail[trail.length - 1][keys[keys.length - 1]];
  for (let i = trail.length - 1; i > 0; i--) {
    if (Object.keys(trail[i]).length) break;
    delete trail[i - 1][keys[i - 1]];
  }
}
