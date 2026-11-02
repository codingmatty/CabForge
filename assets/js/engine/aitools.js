// The AI chat's tools: what the model may read and change in a job. Each
// tool works on the project with the same engine functions the forms use,
// so a change made in chat lays out, builds and saves like one made by hand.
// No DOM here: the chat panel (ui/chat.js) runs these inside updateProject.

import { cornerDoors, newCorner } from './corner.js';
import { countertops } from './countertop.js';
import {
  CABINET_KINDS,
  CABINET_STYLES,
  HINGE_BRANDS,
  JOINERY,
  applyHingeBrand,
  DIVIDERS,
  FRONT_STYLES,
  SECTION_TYPES,
  SLOTS,
  SPACE_PRESETS,
  frontSections,
  newBlindCorner,
  newCabinet,
  newFiller,
  newPanel,
  newSection,
  newSpace,
  runOf,
} from './model.js';
import { addCabinet, atOf, insertCabinet, moveCabinet, projectCutList, refitFronts, relayout, resizeCabinet } from './project.js';
import { ISLAND_TYPES, TURNS, addIsland, addWall, locationById, locations, removeLocation } from './room.js';
import { supplies } from './supplies.js';
import { fmtLen, fmtMm, isImperial, parseLen, unitName } from './units.js';

export class ToolError extends Error {}

const fail = (msg) => {
  throw new ToolError(msg);
};

// ---- input helpers ---------------------------------------------------------

/** A length from the model: a string with or without a unit, or a number in the display units. */
function length(v, what, { min = 0, max = 20000 } = {}) {
  const mm = typeof v === 'number' ? parseLen(String(v)) : parseLen(v);
  if (!Number.isFinite(mm)) fail(`${what}: "${v}" is not a length. Use e.g. "24in", "23 1/2\\"", "4' 6\\"" or "600mm".`);
  if (mm < min - 1e-6 || mm > max + 1e-6) fail(`${what} must be between ${fmtLen(min)} and ${fmtLen(max)} (got ${fmtLen(mm)}).`);
  return mm;
}

const LEN = {
  type: ['string', 'number'],
  description: 'A length with its unit, e.g. "24in", "23 1/2\\"", "4\' 6\\"", "600mm". A bare number is in the shop\'s display units.',
};

function cabinetIndex(p, id) {
  const i = p.cabinets.findIndex((c) => c.id === Number(id));
  if (i < 0) fail(`No cabinet with id ${id}. Call get_layout for the ids.`);
  return i;
}

function locationId(p, at) {
  if (at == null || at === '') return null;
  const loc = locationById(p, String(at)) ?? locations(p).find((l) => l.name.toLowerCase() === String(at).toLowerCase());
  if (!loc) fail(`No wall or island "${at}". Locations: ${locations(p).map((l) => `${l.id} (${l.name})`).join(', ')}.`);
  return loc.id;
}

const label = (spec) => `${spec.name} (id ${spec.id})`;

/** Front sections from the model: [{type, units?, height?, doors?, shelves?, fixed_shelves?, below?}], top to bottom. */
function frontsFrom(list, spec) {
  if (!Array.isArray(list) || !list.length) fail('fronts must be a list of one or more sections, top to bottom.');
  if (list.length > 8) fail('At most 8 front sections.');
  return list.map((s, i) => {
    if (!SECTION_TYPES[s?.type]) fail(`fronts[${i}].type must be one of ${Object.keys(SECTION_TYPES).join(', ')}.`);
    const sec = newSection(s.type, s.type === 'drawer' ? 0 : (s.shelves ?? spec.shelves ?? 1));
    if (s.units != null) {
      if (!(Number.isInteger(s.units) && s.units >= 1 && s.units <= 40)) fail(`fronts[${i}].units must be a whole number of drawer units.`);
      sec.units = s.units;
    } else if (s.height != null) {
      sec.height = length(s.height, `fronts[${i}].height`, { min: 60, max: 2500 });
    }
    if (s.type === 'door' && s.doors != null) {
      if (![0, 1, 2].includes(s.doors)) fail(`fronts[${i}].doors must be 0 (automatic), 1 or 2.`);
      sec.doors = s.doors;
    }
    if (s.type !== 'drawer') {
      if (s.shelves != null) sec.shelves = Math.min(12, Math.max(0, Math.round(s.shelves)));
      if (s.fixed_shelves != null) sec.fixedShelves = Math.min(12, Math.max(0, Math.round(s.fixed_shelves)));
    }
    if (s.below != null) {
      if (!DIVIDERS[s.below]) fail(`fronts[${i}].below must be one of ${Object.keys(DIVIDERS).join(', ')}.`);
      sec.below = s.below;
    }
    return sec;
  });
}

function frontsText(spec) {
  if (spec.corner || spec.kind === 'filler' || spec.kind === 'space') return '';
  return frontSections(spec)
    .map((s) => {
      const size = s.units ? `${s.units}u` : s.height ? fmtLen(s.height) : 'fill';
      const extra = s.type === 'door' ? `${s.doors ? `${s.doors} door${s.doors > 1 ? 's' : ''}` : 'auto doors'}, ${s.shelves ?? 0} shelves` : s.type === 'open' ? `${s.shelves ?? 0} shelves` : '';
      return `${s.type}(${size}${extra ? `, ${extra}` : ''})`;
    })
    .join(' / ');
}

function kindText(spec) {
  if (spec.corner) return `corner ${spec.kind} (${spec.corner.type === 'L' ? 'L' : 'diagonal'})`;
  if (spec.blind) return `blind corner ${spec.kind} (blind part ${fmtLen(spec.blind.width)})`;
  if (spec.panel) return `panel (${spec.run} run)`;
  if (spec.kind === 'filler') return `filler (${spec.run} run)`;
  if (spec.kind === 'space') return `${spec.preset ?? 'space'} space (${spec.run} run)`;
  return spec.kind;
}

// ---- read-only views ---------------------------------------------------------

/** The job as compact text for the model, lengths in the display units. */
export function layoutSummary(p, built = []) {
  const lines = [`Units: ${isImperial() ? 'inches' : 'mm'}. Room height ${fmtLen(p.room?.height ?? 2400)}. Cabinet style: ${CABINET_STYLES[p.construction.cabinetStyle] ?? p.construction.cabinetStyle}.`];
  for (const loc of locations(p)) {
    const where =
      loc.kind === 'wall'
        ? `wall, ${fmtLen(loc.length)} long${loc.index > 0 ? `, ${TURNS[loc.wall.turn].toLowerCase()} from the wall before` : ''}`
        : `island ${loc.island.type === 'double' ? `back-to-back ${loc.row} row` : 'single run'}, at x ${fmtLen(loc.island.x)}, y ${fmtLen(loc.island.z)}, facing ${loc.island.rotation}°`;
    lines.push(`\n${loc.id} "${loc.name}" (${where}):`);
    const here = p.cabinets.map((spec, i) => ({ spec, i })).filter(({ spec }) => atOf(p, spec) === loc.id);
    if (!here.length) lines.push('  (empty)');
    for (const run of ['base', 'wall', 'tall']) {
      for (const { spec, i } of here.filter(({ spec }) => runOf(spec) === run)) {
        const err = built[i]?.error ? `  ERROR: ${built[i].error}` : '';
        const ends = spec.endPanels && (spec.endPanels.left || spec.endPanels.right) ? `, end panels ${['left', 'right'].filter((s) => spec.endPanels[s]).join('+')}` : '';
        const fronts = frontsText(spec);
        const own = spec.overrides?.cabinetStyle ? `, style ${spec.overrides.cabinetStyle}` : '';
        const brk = spec.frameBreak ? ', face frame breaks after it' : '';
        lines.push(
          `  [${run}] id ${spec.id} "${spec.name}" ${kindText(spec)}: x ${fmtLen(spec.x)}, ${fmtLen(spec.width)} W × ${fmtLen(spec.height)} H × ${fmtLen(spec.depth)} D` +
            `${spec.elevation ? `, ${fmtLen(spec.elevation)} off the floor` : ''}${ends}${own}${brk}${fronts ? `; fronts ${fronts}` : ''}${err}`,
        );
      }
    }
  }
  return lines.join('\n');
}

function cabinetDetail(p, id) {
  const spec = p.cabinets[cabinetIndex(p, id)];
  return JSON.stringify({ ...spec, at: atOf(p, spec), units_note: 'Lengths in this JSON are millimetres.' });
}

function settingsSummary(c) {
  const mat = (slot) => c.library.find((m) => m.id === c.materials[slot])?.name ?? '?';
  const sizes = Object.entries(c.cabinetSizes)
    .map(([k, s]) => `${k} ${fmtLen(s.width)} W, box ${fmtLen(s.boxHeight)} H, ${fmtLen(s.depth)} D`)
    .join('; ');
  return [
    `Materials: ${SLOTS.map((s) => `${s} = ${mat(s)}`).join(', ')}. Library: ${c.library
      .filter((m) => !m.edgeBand)
      .map((m) => `"${m.name}" ${fmtMm(m.thickness)}mm`)
      .join(', ')}.`,
    `New cabinet sizes: ${sizes}.`,
    `Base (toe kick): ${c.plinth}, height ${fmtLen(c.toeKickHeight)}, setback ${fmtLen(c.toeKickSetback)}.`,
    `Front style ${c.frontStyle}${c.frontStyle === 'shaker' ? ` (frame ${fmtLen(c.shaker.frame)})` : ''}; reveals side ${fmtLen(c.reveals.side)}, gap ${fmtLen(c.reveals.gap)}, top ${fmtLen(c.reveals.top)}, bottom ${fmtLen(c.reveals.bottom)}; doors wider than ${fmtLen(c.maxSingleDoorWidth)} become pairs.`,
    `Back joint ${c.back.type}; stretchers ${fmtLen(c.stretcherWidth)}.`,
    `Cabinet style ${c.cabinetStyle}; inset gap ${fmtLen(c.insetGap)}, face-frame overlay ${fmtLen(c.frameOverlay)}. Face frames: top rail ${fmtLen(c.faceFrame.topRail)}, bottom rail ${fmtLen(c.faceFrame.bottomRail)}, rails between fronts ${fmtLen(c.faceFrame.midRail)}, scribe ${fmtLen(c.faceFrame.scribe)}, ${c.faceFrame.continuous ? 'continuous along runs' : 'one per cabinet'}, ${c.faceFrame.joinery} joints, wood ${(c.woods ?? []).find((w) => w.id === c.faceFrame.wood)?.name ?? '?'}. Hinges from ${c.hingeBrand}.`,
    `Countertop ${c.countertop.enabled ? `on: ${fmtLen(c.countertop.thickness)} thick, ${fmtLen(c.countertop.frontOverhang)} front overhang, ${fmtLen(c.countertop.endOverhang)} end overhang` : 'off'}.`,
    `End panels: ${fmtLen(c.endPanel.frontOverhang)} front overhang, ${fmtLen(c.endPanel.rearScribe)} rear scribe.`,
    `Drawer unit ${fmtMm(c.drawerUnit)} mm.`,
  ].join('\n');
}

function materialsReport(p, built) {
  const cabinets = built.filter((b) => b.cabinet).map((b) => b.cabinet);
  const s = supplies(cabinets, p.construction, null, countertops(p, built));
  const list = projectCutList(p, built);
  const money = (v) => (v == null ? 'not priced' : `$${v.toFixed(2)}`);
  return [
    `Parts: ${list.rows.reduce((n, r) => n + r.qty, 0)} in ${list.rows.length} cut-list rows.`,
    ...s.sheets.map((m) => `${m.material} ${fmtMm(m.thickness)}mm: ${m.parts} parts, ${m.areaM2.toFixed(2)} m² of parts${m.unitCost ? `, ${money(m.unitCost)}/sheet` : ''}`),
    `Edge banding ${s.edgeBandM.toFixed(1)} m; countertop ${s.topM.toFixed(2)} m.`,
    ...s.hardware.map((h) => `${h.item}: ${h.qty} ${h.unit} (${h.spec})`),
    `Material cost ${money(s.materialCost)}, hardware ${money(s.hardwareCost)}, total ${money(s.totalCost)} (sheet counts come from nesting in the app; costs here leave sheets out until nested).`,
  ].join('\n');
}

// ---- settings the model may change -----------------------------------------------

const SETTINGS = {
  // Lengths.
  toeKickHeight: 'len',
  toeKickSetback: 'len',
  maxSingleDoorWidth: 'len',
  stretcherWidth: 'len',
  'reveals.side': 'len',
  'reveals.gap': 'len',
  'reveals.top': 'len',
  'reveals.bottom': 'len',
  'cabinetSizes.base.width': 'len',
  'cabinetSizes.base.boxHeight': 'len',
  'cabinetSizes.base.depth': 'len',
  'cabinetSizes.wall.width': 'len',
  'cabinetSizes.wall.boxHeight': 'len',
  'cabinetSizes.wall.depth': 'len',
  'cabinetSizes.tall.width': 'len',
  'cabinetSizes.tall.boxHeight': 'len',
  'cabinetSizes.tall.depth': 'len',
  'countertop.thickness': 'len',
  'countertop.frontOverhang': 'len',
  'countertop.endOverhang': 'len',
  'endPanel.frontOverhang': 'len',
  'endPanel.rearScribe': 'len',
  'endPanel.floorScribe': 'len',
  'shaker.frame': 'len',
  insetGap: 'len',
  frameOverlay: 'len',
  'faceFrame.topRail': 'len',
  'faceFrame.bottomRail': 'len',
  'faceFrame.midRail': 'len',
  'faceFrame.scribe': 'len',
  'faceFrame.tenon': 'len',
  cabinetStyle: Object.keys(CABINET_STYLES),
  'faceFrame.joinery': Object.keys(JOINERY),
  hingeBrand: Object.keys(HINGE_BRANDS),
  'faceFrame.continuous': 'bool',
  // Choices.
  plinth: ['frame', 'board', 'sides', 'none'],
  frontStyle: Object.keys(FRONT_STYLES),
  'back.type': ['butt', 'dado'],
  // Switches and text.
  'countertop.enabled': 'bool',
  toeKickCover: 'bool',
  'countertop.name': 'text',
  'countertop.color': 'color',
  // Material slots, by library material name or id.
  'materials.case': 'material',
  'materials.front': 'material',
  'materials.drawerBox': 'material',
  'materials.panel': 'material',
};

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}

function settingValue(c, path, v) {
  const kind = SETTINGS[path];
  if (!kind) fail(`"${path}" can't be changed here. Settings: ${Object.keys(SETTINGS).join(', ')}.`);
  if (kind === 'len') return length(v, path, { min: 0, max: 3000 });
  if (Array.isArray(kind)) {
    if (!kind.includes(v)) fail(`${path} must be one of ${kind.join(', ')}.`);
    return path === 'back.type' && v === 'dado' ? undefined : v;
  }
  if (kind === 'bool') {
    if (typeof v !== 'boolean') fail(`${path} must be true or false.`);
    return v;
  }
  if (kind === 'text') return String(v).slice(0, 60);
  if (kind === 'color') {
    if (!/^#[0-9a-f]{6}$/i.test(String(v))) fail(`${path} must be a colour like #8b8f96.`);
    return String(v);
  }
  // material
  const m = c.library.find((m) => !m.edgeBand && (m.id === Number(v) || m.name.toLowerCase() === String(v).toLowerCase()));
  if (!m) fail(`No sheet material "${v}". Library: ${c.library.filter((m) => !m.edgeBand).map((m) => m.name).join(', ')}.`);
  return m.id;
}

// ---- the tools -----------------------------------------------------------------

const KINDS = ['base', 'wall', 'tall', 'corner_base', 'corner_wall', 'blind_base', 'blind_wall'];
const ITEMS = ['filler', 'panel', ...Object.keys(SPACE_PRESETS)];

const FRONTS_SCHEMA = {
  type: 'array',
  description: 'Front sections from the top down. Omit to keep the default (one door section).',
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: Object.keys(SECTION_TYPES) },
      units: { type: 'integer', description: 'Drawer or door front height in drawer units (preferred for drawers).' },
      height: { ...LEN, description: 'Front height as a length, instead of units. Omit both to fill what is left.' },
      doors: { type: 'integer', enum: [0, 1, 2], description: 'Doors: 0 = automatic (pair when wide).' },
      shelves: { type: 'integer', description: 'Adjustable shelves (door and open sections).' },
      fixed_shelves: { type: 'integer' },
      below: { type: 'string', enum: Object.keys(DIVIDERS), description: 'What divides it from the section under it.' },
    },
    required: ['type'],
  },
};

/** Tool definitions sent to the model: name, description, JSON schema. */
export const AI_TOOLS = [
  {
    name: 'get_layout',
    description: 'The current job: walls and islands with their ids, and every cabinet in order along each with id, kind, position and size. The latest layout is also attached to each user message.',
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_cabinet',
    description: 'One cabinet in full (JSON, lengths in mm), including its fronts and any construction overrides.',
    schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  {
    name: 'get_settings',
    description: "The job's construction settings: materials, default cabinet sizes, toe kick, front style, reveals, countertop.",
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_materials_report',
    description: 'Parts count, sheet materials and area, edge banding, countertop length, hardware and costs for the job.',
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'add_cabinet',
    mutates: true,
    description:
      'Adds a cabinet. Cabinets stand in runs (base, wall, tall) along a wall or island, left to right in list order; the layout closes up gaps itself, so place by order (after_id), not by x. Unset sizes use the job defaults.',
    schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS },
        at: { type: 'string', description: 'Wall or island id (e.g. "w1", "i3") or name. Default: after after_id, else the first wall.' },
        after_id: { type: 'integer', description: 'Put it right after this cabinet (same wall or island). Omit to add at the end of its run.' },
        name: { type: 'string' },
        width: LEN,
        height: { ...LEN, description: 'Overall height, including the toe kick for base and tall cabinets. ' + LEN.description },
        depth: { ...LEN, description: 'Case depth, without the doors. ' + LEN.description },
        elevation: { ...LEN, description: 'Height of the cabinet bottom off the floor (wall cabinets). ' + LEN.description },
        fronts: FRONTS_SCHEMA,
        end_panels: { type: 'object', properties: { left: { type: 'boolean' }, right: { type: 'boolean' } } },
      },
      required: ['kind'],
    },
  },
  {
    name: 'add_item',
    mutates: true,
    description: 'Adds a filler strip, a standing end panel, or an appliance space (space, dishwasher, range, fridge) to a run. Spaces keep room for appliances; nothing is built for them.',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ITEMS },
        at: { type: 'string', description: 'Wall or island id or name.' },
        after_id: { type: 'integer' },
        run: { type: 'string', enum: ['base', 'wall', 'tall'], description: 'Run for fillers and panels (default base).' },
        width: LEN,
      },
      required: ['type'],
    },
  },
  {
    name: 'update_cabinet',
    mutates: true,
    description: 'Changes a cabinet, filler or space: name, size, elevation, fronts, end panels, its own cabinet style, a face frame break after it, a blind corner\'s blind part. Widening pushes the cabinets after it along.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        style: { type: 'string', enum: ['job', ...Object.keys(CABINET_STYLES)], description: 'This cabinet\'s style; "job" follows the job setting.' },
        frame_break: { type: 'boolean', description: 'Face frames: break the frame after this cabinet.' },
        blind_width: { ...LEN, description: 'Blind corners: the blind part of the front, from the corner end. ' + LEN.description },
        name: { type: 'string' },
        width: LEN,
        height: LEN,
        depth: LEN,
        elevation: LEN,
        fronts: FRONTS_SCHEMA,
        end_panels: { type: 'object', properties: { left: { type: 'boolean' }, right: { type: 'boolean' } } },
      },
      required: ['id'],
    },
  },
  {
    name: 'move_cabinet',
    mutates: true,
    description: 'Moves a cabinet to another wall or island and/or to just after another cabinet. after_id 0 puts it at the start of its run.',
    schema: { type: 'object', properties: { id: { type: 'integer' }, at: { type: 'string' }, after_id: { type: 'integer' } }, required: ['id'] },
  },
  {
    name: 'remove_cabinet',
    mutates: true,
    description: 'Deletes a cabinet, filler, panel or space. The run closes up.',
    schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  {
    name: 'update_room',
    mutates: true,
    description:
      'Room changes. Walls run one after another: wall 1 left to right, each next wall turning 90° at an inside (usual kitchen corner) or outside corner. Islands stand free: x, y is the top-left of their cabinets in the plan, y measured out from wall 1; facing 0/90/180/270.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['set_height', 'add_wall', 'update_wall', 'remove_wall', 'add_island', 'update_island', 'remove_island'] },
        id: { type: 'string', description: 'Wall or island id for update/remove (e.g. "w2", "i3").' },
        name: { type: 'string' },
        height: { ...LEN, description: 'Ceiling height (set_height).' },
        length: { ...LEN, description: 'Wall length.' },
        turn: { type: 'string', enum: Object.keys(TURNS), description: 'Corner at the start of this wall.' },
        type: { type: 'string', enum: Object.keys(ISLAND_TYPES), description: 'Island: single run or back to back.' },
        x: LEN,
        y: LEN,
        facing: { type: 'integer', enum: [0, 90, 180, 270] },
        overhang: { ...LEN, description: 'Island seating overhang.' },
        ends: { ...LEN, description: 'Island countertop overhang past both ends.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'update_settings',
    mutates: true,
    description: `Changes the job's construction settings. Each change is {path, value}. Paths: ${Object.keys(SETTINGS).join(', ')}. Lengths take units; materials take a library name.`,
    schema: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          items: { type: 'object', properties: { path: { type: 'string' }, value: { type: ['string', 'number', 'boolean'] } }, required: ['path', 'value'] },
        },
      },
      required: ['changes'],
    },
  },
];

const TOOLS_BY_NAME = Object.fromEntries(AI_TOOLS.map((t) => [t.name, t]));
export const isMutating = (name) => !!TOOLS_BY_NAME[name]?.mutates;

/** Places a new spec: after a cabinet, or at the end of its run at a location. Returns its index. */
function place(p, spec, at, afterId) {
  if (afterId != null) {
    const i = cabinetIndex(p, afterId);
    spec.at = at ?? atOf(p, p.cabinets[i]);
    return insertCabinet(p, spec, i + 1);
  }
  spec.at = at ?? locations(p)[0].id;
  return addCabinet(p, spec);
}

function applySize(p, index, input) {
  const spec = p.cabinets[index];
  if (input.height != null) spec.height = length(input.height, 'height', { min: 100, max: 3000 });
  if (input.depth != null) spec.depth = length(input.depth, 'depth', { min: 50, max: 1500 });
  if (input.elevation != null) spec.elevation = length(input.elevation, 'elevation', { min: 0, max: 3000 });
  if (input.width != null) resizeCabinet(p, index, length(input.width, 'width', { min: 5, max: 3000 }));
}

/**
 * Runs a tool on the project (mutating it for changing tools). Returns
 * { result: string, change?: string }; throws ToolError for a bad request.
 */
export function runTool(p, built, name, input = {}) {
  input ??= {};
  switch (name) {
    case 'get_layout':
      return { result: layoutSummary(p, built) };
    case 'get_cabinet':
      return { result: cabinetDetail(p, input.id) };
    case 'get_settings':
      return { result: settingsSummary(p.construction) };
    case 'get_materials_report':
      return { result: materialsReport(p, built) };

    case 'add_cabinet': {
      if (!KINDS.includes(input.kind)) fail(`kind must be one of ${KINDS.join(', ')}.`);
      const at = locationId(p, input.at);
      const c = p.construction;
      const spec = input.kind.startsWith('corner_') ? newCorner(input.kind.slice(7), 0, c) : input.kind.startsWith('blind_') ? newBlindCorner(input.kind.slice(6), 0, c) : newCabinet(input.kind, 0, c);
      if (input.fronts && !spec.corner) spec.fronts = { type: 'stack', sections: frontsFrom(input.fronts, spec) };
      if (input.end_panels) spec.endPanels = { left: !!input.end_panels.left, right: !!input.end_panels.right };
      const index = place(p, spec, at, input.after_id);
      if (input.name) spec.name = String(input.name).slice(0, 60);
      else spec.name = `${input.kind.startsWith('corner_') ? `Corner ${spec.kind}` : spec.blind ? `Blind corner ${spec.kind}` : CABINET_KINDS[spec.kind].label} ${spec.id}`;
      applySize(p, index, input);
      relayout(p);
      return { result: `Added ${label(spec)} at ${atOf(p, spec)}.`, change: `Added ${spec.name} (${fmtLen(spec.width)})` };
    }

    case 'add_item': {
      if (!ITEMS.includes(input.type)) fail(`type must be one of ${ITEMS.join(', ')}.`);
      const at = locationId(p, input.at);
      const c = p.construction;
      const run = input.run ?? 'base';
      if (!CABINET_KINDS[run]) fail('run must be base, wall or tall.');
      const spec = input.type === 'filler' ? newFiller(run, 0, c) : input.type === 'panel' ? newPanel(run, 0, c) : newSpace(input.type, 0, c);
      const index = place(p, spec, at, input.after_id);
      spec.name = input.type === 'filler' ? `Filler ${spec.id}` : input.type === 'panel' ? `Panel ${spec.id}` : `${SPACE_PRESETS[input.type].label} ${spec.id}`;
      if (input.width != null && input.type !== 'panel') resizeCabinet(p, index, length(input.width, 'width', { min: 5, max: 3000 }));
      relayout(p);
      return { result: `Added ${label(spec)} at ${atOf(p, spec)}.`, change: `Added ${spec.name} (${fmtLen(spec.width)})` };
    }

    case 'update_cabinet': {
      const index = cabinetIndex(p, input.id);
      const spec = p.cabinets[index];
      const before = `${fmtLen(spec.width)} × ${fmtLen(spec.height)} × ${fmtLen(spec.depth)}`;
      if (input.fronts) {
        if (spec.corner || spec.kind === 'filler' || spec.kind === 'space') fail(`${spec.name} has no front sections to set.`);
        spec.fronts = { type: 'stack', sections: frontsFrom(input.fronts, spec) };
      }
      if (input.end_panels) spec.endPanels = { left: !!input.end_panels.left, right: !!input.end_panels.right };
      if (input.name) spec.name = String(input.name).slice(0, 60);
      if (input.style != null) {
        if (input.style !== 'job' && !CABINET_STYLES[input.style]) fail(`style must be job or one of ${Object.keys(CABINET_STYLES).join(', ')}.`);
        const was = structuredClone(spec.overrides ?? {});
        spec.overrides ??= {};
        if (input.style === 'job' || input.style === p.construction.cabinetStyle) delete spec.overrides.cabinetStyle;
        else spec.overrides.cabinetStyle = input.style;
        refitFronts(p, p.construction, index, was);
      }
      if (input.frame_break != null) {
        if (input.frame_break) spec.frameBreak = true;
        else delete spec.frameBreak;
      }
      if (input.blind_width != null) {
        if (!spec.blind) fail(`${spec.name} is not a blind corner.`);
        spec.blind = { ...spec.blind, width: length(input.blind_width, 'blind_width', { min: 0, max: 2000 }) };
      }
      applySize(p, index, input);
      relayout(p);
      const after = `${fmtLen(spec.width)} × ${fmtLen(spec.height)} × ${fmtLen(spec.depth)}`;
      return { result: `Updated ${label(spec)}: ${after}.`, change: `Changed ${spec.name}${before !== after ? ` (${before} → ${after})` : ''}` };
    }

    case 'move_cabinet': {
      let index = cabinetIndex(p, input.id);
      const spec = p.cabinets[index];
      const at = locationId(p, input.at);
      if (at) spec.at = at;
      if (input.after_id != null && Number(input.after_id) !== 0) {
        const target = cabinetIndex(p, input.after_id);
        if (target === index) fail('A cabinet cannot go after itself.');
        spec.at = at ?? atOf(p, p.cabinets[target]);
        moveCabinet(p, index, target > index ? target : target + 1);
      } else if (input.after_id === 0) {
        // The start of its run at its location.
        const first = p.cabinets.findIndex((c, i) => i !== index && atOf(p, c) === atOf(p, spec) && runOf(c) === runOf(spec));
        if (first >= 0) moveCabinet(p, index, first > index ? first - 1 : first);
      }
      relayout(p);
      index = p.cabinets.indexOf(spec);
      return { result: `Moved ${label(spec)}: now at ${atOf(p, spec)}, x ${fmtLen(spec.x)}.`, change: `Moved ${spec.name}` };
    }

    case 'remove_cabinet': {
      const index = cabinetIndex(p, input.id);
      const [spec] = p.cabinets.splice(index, 1);
      relayout(p);
      return { result: `Removed ${label(spec)}.`, change: `Removed ${spec.name}` };
    }

    case 'update_room':
      return updateRoom(p, input);

    case 'update_settings': {
      const changes = Array.isArray(input.changes) ? input.changes : fail('changes must be a list of {path, value}.');
      // Check every change before applying any.
      const values = changes.map((ch) => [ch.path, settingValue(p.construction, ch.path, ch.value)]);
      const before = structuredClone(p.construction);
      for (const [path, v] of values) {
        if (path === 'back.type') p.construction.back = v === undefined ? { type: 'dado', depth: 6 } : { type: 'butt' };
        else if (path === 'hingeBrand') applyHingeBrand(p.construction, v);
        else setPath(p.construction, path, v);
      }
      // A style, rail or reveal change refits drawer stacks sized in units.
      refitFronts(p, before);
      relayout(p);
      const names = values.map(([path]) => path).join(', ');
      return { result: `Updated ${names}.`, change: `Settings: ${names}` };
    }

    default:
      fail(`Unknown tool ${name}.`);
  }
}

function updateRoom(p, input) {
  const room = p.room;
  const wallOf = (id) => room.walls.find((w) => `w${w.id}` === String(id)) ?? fail(`No wall ${id}.`);
  const islandOf = (id) => room.islands.find((i) => `i${i.id}` === String(id).replace(/b$/, '')) ?? fail(`No island ${id}.`);
  switch (input.action) {
    case 'set_height':
      room.height = length(input.height, 'height', { min: 500, max: 6000 });
      return { result: `Room height ${fmtLen(room.height)}.`, change: `Room height ${fmtLen(room.height)}` };
    case 'add_wall':
    case 'update_wall': {
      let wall;
      if (input.action === 'add_wall') {
        const id = addWall(p);
        wall = wallOf(id);
      } else wall = wallOf(input.id);
      if (input.name) wall.name = String(input.name).slice(0, 40);
      if (input.length != null) wall.length = length(input.length, 'length', { min: 100, max: 30000 });
      if (input.turn != null) {
        if (!TURNS[input.turn]) fail('turn must be inside or outside.');
        wall.turn = input.turn;
      }
      relayout(p);
      const verb = input.action === 'add_wall' ? 'Added' : 'Updated';
      return { result: `${verb} w${wall.id} "${wall.name}", ${fmtLen(wall.length)}.`, change: `${verb} ${wall.name} (${fmtLen(wall.length)})` };
    }
    case 'remove_wall': {
      const wall = wallOf(input.id);
      if (room.walls.length <= 1) fail('The room needs at least one wall.');
      removeLocation(p, 'wall', wall.id);
      relayout(p);
      return { result: `Removed ${wall.name}; its cabinets moved to the first wall.`, change: `Removed ${wall.name}` };
    }
    case 'add_island':
    case 'update_island': {
      const island = input.action === 'add_island' ? islandOf(addIsland(p)) : islandOf(input.id);
      if (input.name) island.name = String(input.name).slice(0, 40);
      if (input.type != null) {
        if (!ISLAND_TYPES[input.type]) fail(`type must be ${Object.keys(ISLAND_TYPES).join(' or ')}.`);
        island.type = input.type;
      }
      if (input.x != null) island.x = length(input.x, 'x', { min: -30000, max: 30000 });
      if (input.y != null) island.z = length(input.y, 'y', { min: -30000, max: 30000 });
      if (input.facing != null) {
        if (![0, 90, 180, 270].includes(input.facing)) fail('facing must be 0, 90, 180 or 270.');
        island.rotation = input.facing;
      }
      if (input.overhang != null) island.overhang = length(input.overhang, 'overhang', { min: 0, max: 1000 });
      if (input.ends != null) island.ends = length(input.ends, 'ends', { min: 0, max: 1000 });
      relayout(p);
      const verb = input.action === 'add_island' ? 'Added' : 'Updated';
      return { result: `${verb} i${island.id} "${island.name}". Add cabinets to it with at: "i${island.id}".`, change: `${verb} ${island.name}` };
    }
    case 'remove_island': {
      const island = islandOf(input.id);
      removeLocation(p, 'island', island.id);
      relayout(p);
      return { result: `Removed ${island.name}; its cabinets moved to the first wall.`, change: `Removed ${island.name}` };
    }
    default:
      fail('Unknown room action.');
  }
}

/** The system prompt: what CabForge is and how to work with it. */
export function systemPrompt() {
  const units = unitName() === 'in' ? 'inches (fractions like 23 1/2", feet and inches over 36")' : 'millimetres';
  return [
    'You are the design assistant in CabForge, a cabinet design app for a cabinet shop (32mm system cases).',
    'You lay out and change kitchen and built-in cabinet jobs with the tools, and answer questions about the job.',
    '',
    'How the job works:',
    '- The room is walls in sequence (wall 1 runs left to right, each next wall turns 90° at an inside or outside corner) plus free-standing islands.',
    '- Cabinets stand in three runs along each wall or island: base, wall (upper) and tall. Within a run they sit left to right in list order with no gaps; place them by order (after_id), never by coordinates.',
    '- Base and tall heights include the toe kick. Depth is the case without doors. Wall cabinets hang at their elevation.',
    '- Fronts are sections from the top down: doors, drawers (sized in drawer units) or open; a drawer bank is several drawer sections.',
    '- Fillers close gaps at walls; spaces (dishwasher, range, fridge) keep room for appliances. Corner cabinets go at the end of a wall and return along the next one.',
    '- Cabinet styles (setting cabinetStyle, or one cabinet\'s style with update_cabinet): frameless (overlay fronts), framelessInset, faceFrameInset, faceFrameOverlay. Face frames are solid wood, continuous along a run; a filler becomes a wider stile; frame_break splits a frame after a cabinet. In face-frame jobs use blind corners (blind_base, blind_wall) at the end of a wall instead of the L and diagonal corners. Changing the style refits drawer stacks in units.',
    `- The shop works in ${units}. Give every length you pass to a tool with its unit, and talk to the user in these units.`,
    '',
    'How to work:',
    '- Each user message ends with the current layout (the user may have edited by hand since your last turn). Use the ids it shows.',
    '- Make the changes the user asks for with the tools, several at a time when they are independent. Use the job defaults for anything the user did not specify, and say what you assumed.',
    '- If a request is ambiguous in a way that changes the design (which wall, how wide), ask one short question instead of guessing.',
    '- If no tool can do what the user asks, say so plainly.',
    '- After changing the job, reply in one or two short sentences with what changed. The user sees each change listed, with an Undo button.',
  ].join('\n');
}
