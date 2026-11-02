// Cabinet dialog: the selected cabinet's size, fronts and placement, and its
// own construction settings. Opened from the gear on a cabinet row (or a
// double-click); ‹ › step through the cabinets without closing it.

import { cornerDoors, cornerLegs } from '../engine/corner.js';
import {
  CABINET_STYLES,
  DIVIDERS,
  JOINERY,
  SECTION_TYPES,
  blindDepth,
  isFaceFrame,
  isInset,
  FRONT_STYLES,
  SLOT_LABELS,
  SPACE_PRESETS,
  defaultUnits,
  deletePath,
  drawerSize,
  effectiveConstruction,
  fmtMm,
  frontSections,
  getPath,
  hasPath,
  hasPlinth,
  materialLabel,
  newFiller,
  newSection,
  newSpace,
  setPath,
  spaceSize,
  stackFronts,
  toeHeight,
  unitFrontHeight,
} from '../engine/model.js';
import { atOf, baseSource, jobFor, standOff, placeAfter, placedAfter, refitFronts, relayout, resizeCabinet, runNeighbours } from '../engine/project.js';
import { locations } from '../engine/room.js';
import { checkboxField, h, lenField, lenInput, mount, numField, selectField, sizeReference, textField } from './dom.js';
import { fmtLen, fmtLenU, isImperial, unitName } from '../engine/units.js';
import { select, setState, state, updateProject } from './store.js';

const close = () => setState({ cabDialog: null });

function editCabinet(fn) {
  const i = state.selected;
  updateProject((p) => {
    if (p.cabinets[i]) fn(p.cabinets[i]);
  });
}

// ---- size, fronts and placement -------------------------------------------

const DOOR_COUNTS = [
  [0, 'Auto'],
  [1, '1'],
  [2, '2'],
];

export const RUN_LABELS = { base: 'Base', wall: 'Wall', tall: 'Tall' };

/** The drawer sizes to pick from: the construction's, plus `current` if it isn't one. */
function sizeOptions(con, current) {
  const units = [...new Set([...con.drawerSizes.map((s) => s.units), ...[current].flat().filter(Boolean)])].sort((a, b) => a - b);
  return units.map((u) => {
    const box = drawerSize(con, u)?.box;
    return [u, `${u} units · ${fmtMm(unitFrontHeight(con, u))} mm${box ? ` · box ${fmtMm(box)}` : ''}`];
  });
}

/** Edits the selected cabinet's front sections (a copy, top to bottom). */
function editSections(fn) {
  editCabinet((c) => {
    const list = stackFronts(c).sections;
    fn(list);
    c.fronts = { type: 'stack', sections: list };
  });
}

const SIZE_FILL = 'fill';
const SIZE_CUSTOM = 'custom';

/** One front section: what it is, its size, doors and shelves, and what divides it from the next. */
function frontSectionCard(sec, i, n, con) {
  const set = (fn) => editSections((list) => fn(list[i], list));
  const size = sec.units > 0 ? sec.units : sec.height > 0 ? SIZE_CUSTOM : SIZE_FILL;
  const where = n === 1 ? '' : i === 0 ? ' · top' : i === n - 1 ? ' · bottom' : '';
  const move = (to) => editSections((list) => list.splice(to, 0, ...list.splice(i, 1)));
  const shelfCount = (v) => Math.min(12, Math.max(0, Math.round(v)));
  return h(
    'div',
    { class: 'front-sec' },
    h(
      'div',
      { class: 'front-sec-head' },
      h('strong', {}, `${i + 1}. ${SECTION_TYPES[sec.type]}`, h('span', { class: 'muted' }, where)),
      h(
        'span',
        { class: 'front-sec-tools' },
        h('button', { type: 'button', class: 'icon-btn', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i - 1) }, '↑'),
        h('button', { type: 'button', class: 'icon-btn', title: 'Move down', 'aria-label': 'Move down', disabled: i === n - 1, onclick: () => move(i + 1) }, '↓'),
        h('button', { type: 'button', class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove', disabled: n === 1, onclick: () => editSections((list) => list.splice(i, 1)) }, '✕'),
      ),
    ),
    h(
      'div',
      { class: 'fields' },
      selectField('Type', `sec-${i}-type`, Object.entries(SECTION_TYPES), sec.type, (v) =>
        set((cur, list) => {
          // A section turned into a drawer gets its stretcher.
          const below = v === 'drawer' && cur.below === 'none' ? 'stretcher' : cur.below;
          list[i] = { ...newSection(v), units: cur.units, height: cur.height, below };
        }),
      ),
      selectField(
        'Height',
        `sec-${i}-size`,
        [[SIZE_FILL, 'Fills the rest'], [SIZE_CUSTOM, `Custom (${unitName()})`], ...sizeOptions(con, sec.units)],
        size,
        (v) =>
          set((cur) => {
            delete cur.units;
            delete cur.height;
            if (v === SIZE_CUSTOM) cur.height = Math.round(unitFrontHeight(con, 5));
            else if (v !== SIZE_FILL) cur.units = Number(v);
          }),
      ),
      size === SIZE_CUSTOM ? lenField('Front height', `sec-${i}-height`, sec.height, (v) => set((cur) => (cur.height = Math.max(60, v)))) : null,
      sec.type === 'door' ? selectField('Doors', `sec-${i}-doors`, DOOR_COUNTS, sec.doors ?? 0, (v) => set((cur) => (cur.doors = Number(v)))) : null,
      sec.type === 'drawer'
        ? null
        : [
            numField('Adjustable shelves', `sec-${i}-shelves`, sec.shelves ?? 0, (v) => set((cur) => (cur.shelves = shelfCount(v)))),
            numField('Fixed shelves', `sec-${i}-fixed`, sec.fixedShelves ?? 0, (v) => set((cur) => (cur.fixedShelves = shelfCount(v)))),
          ],
      i < n - 1 ? selectField('Under it', `sec-${i}-below`, Object.entries(DIVIDERS), sec.below ?? 'none', (v) => set((cur) => (cur.below = v))) : null,
    ),
  );
}

/** How much of the front space the sized sections take. */
function stackNote(c, con, sections) {
  const r = con.reveals;
  const span = c.height - toeHeight(con, c) - r.top - r.bottom;
  const sized = sections.map((sec) => (sec.units > 0 ? unitFrontHeight(con, sec.units) : sec.height > 0 ? sec.height : null));
  const fills = sized.filter((v) => v == null).length;
  const used = sized.reduce((n, v) => n + (v ?? 0), 0) + (sections.length - 1) * r.gap;
  const left = span - used;
  const over = left < -0.05 || (fills && left < 60 * fills);
  const text =
    `${fmtLenU(span)} of fronts, top to bottom. ` +
    (fills
      ? `${fills === 1 ? 'The section with no height takes' : `The ${fills} sections with no height share`} the ${fmtLenU(Math.max(0, left))} left.`
      : left > 0.05
        ? `${fmtLenU(left)} left open at the bottom.`
        : left < -0.05
          ? `${fmtLenU(-left)} too much.`
          : 'They fill the cabinet.');
  const drawers = sections.filter((sec) => sec.type === 'drawer');
  // All drawers: size them in units, as a new drawer base starts.
  const fit =
    drawers.length === sections.length
      ? h(
          'button',
          {
            type: 'button',
            title: 'Size the drawers in units, as new drawer bases start',
            onclick: () =>
              editSections((list) => {
                const units = defaultUnits(con, c, list.length);
                list.forEach((sec, i) => {
                  delete sec.height;
                  sec.units = units[i];
                });
              }),
          },
          'Drawers in units',
        )
      : null;
  return h('p', { class: over ? 'units-note error' : 'units-note muted' }, text, fit);
}

function frontStack(c) {
  const con = effectiveConstruction(jobFor(state.project, state.selected), c.overrides);
  const sections = frontSections(c);
  const add = (type) => editSections((list) => list.push(newSection(type, type === 'drawer' ? 0 : 1)));
  return h(
    'div',
    { class: 'front-stack wide' },
    sections.map((sec, i) => frontSectionCard(sec, i, sections.length, con)),
    h(
      'div',
      { class: 'add-row' },
      h('button', { type: 'button', onclick: () => add('door') }, '+ Door'),
      h('button', { type: 'button', onclick: () => add('drawer') }, '+ Drawer'),
      h('button', { type: 'button', onclick: () => add('open') }, '+ Open'),
    ),
    stackNote(c, con, sections),
  );
}

/** Moves the selected cabinet to just after `afterId` in its run (null: the start). */
function placeSelectedAfter(afterId) {
  let index = state.selected;
  updateProject((p) => {
    index = placeAfter(p, index, afterId);
  });
  select(index);
}

// A length of the cabinet, and a plain number (shelf count).
const num = (c, label, key, get, set, opts) => lenField(label, key, get(c), (v) => editCabinet((c) => set(c, v)), opts);
const count = (c, label, key, get, set, opts) => numField(label, key, get(c), (v) => editCabinet((c) => set(c, v)), opts);

function resizeField(c, min = 0) {
  return lenField(
    'Width',
    'width',
    c.width,
    (v) => {
      const i = state.selected;
      updateProject((p) => resizeCabinet(p, i, Math.max(min, v)));
    },
  );
}

/** A filler's name, width and where it sits; it takes its height, depth and elevation from its run. */
function fillerSection(c) {
  const p = state.project;
  const neighbours = runNeighbours(p, state.selected);
  const after = placedAfter(p, state.selected);
  return section(
    c.panel ? 'Panel' : 'Filler',
    [
      textField('Name', 'name', c.name, (v) => editCabinet((c) => (c.name = v)), { wide: true }),
      c.panel
        ? h('label', { class: 'field', title: 'A panel is as wide as its front material is thick' }, h('span', {}, 'Width'), h('input', { value: isImperial() ? fmtLen(c.width) : fmtMm(c.width), disabled: true }))
        : resizeField(c, 5),
      selectField('Run', 'run', Object.entries(RUN_LABELS), c.run, (run) => {
        const i = state.selected;
        updateProject((p) => {
          const { height, depth, elevation } = newFiller(run, 0, p.construction);
          Object.assign(p.cabinets[i], { run, height, depth, elevation });
          relayout(p);
        });
      }),
      selectField(
        'Place after',
        'placeAfter',
        [['start', 'Start of run'], ...neighbours.map((n) => [n.spec.id, n.spec.name])],
        after ?? 'start',
        (v) => placeSelectedAfter(v === 'start' ? null : Number(v)),
        { wide: true },
      ),
    ],
    c.panel
      ? 'A finished end panel standing on its own, cut from the front material and as wide as it is thick. Its scribes, overhang and toe-kick notch are the end panel settings.'
      : 'Cut from the front material and set flush with the doors; base and tall fillers carry the plinth front through.',
  );
}

/** Which wall or island the cabinet stands at; moving it re-lays both. */
function locationField(c) {
  const p = state.project;
  return selectField(
    'Wall / island',
    'at',
    locations(p).map((l) => [l.id, l.name]),
    atOf(p, c),
    (v) => {
      const i = state.selected;
      updateProject((p) => {
        p.cabinets[i].at = v;
        relayout(p);
      });
      setState({ at: v });
    },
    { wide: true },
  );
}

/** A corner cabinet's legs, door openings and back-corner chamfer. */
function cornerSection(c) {
  const con = effectiveConstruction(jobFor(state.project, state.selected), c.overrides);
  const p = state.project;
  const loc = locations(p).find((l) => l.id === atOf(p, c));
  const next = locations(p).find((l) => l.kind === 'wall' && l.index === loc?.index + 1);
  const setCorner = (fn) =>
    updateProject((p) => {
      fn(p.cabinets[state.selected]);
      relayout(p);
    });
  const fields = [];
  if (c.corner.type === 'L') {
    const { openingA, openingB } = cornerDoors(c, con);
    const legs = (a, b) => setCorner((spec) => {
      const l = cornerLegs(spec, con, a, b);
      spec.width = l.width;
      spec.corner = { ...spec.corner, return: l.return };
    });
    fields.push(
      lenField('Door opening (this wall)', 'cornerA', openingA, (v) => legs(Math.max(100, v), openingB)),
      lenField('Door opening (next wall)', 'cornerB', openingB, (v) => legs(openingA, Math.max(100, v))),
    );
  } else {
    fields.push(
      lenField('Along this wall', 'cornerW', c.width, (v) => setCorner((spec) => (spec.width = Math.max(spec.depth + 100, v)))),
      lenField('Along the next wall', 'cornerR', c.corner.return, (v) => setCorner((spec) => (spec.corner = { ...spec.corner, return: Math.max(spec.depth + 100, v) }))),
    );
  }
  fields.push(lenField('Back corner 45° (each wall)', 'cornerCh', c.corner.chamfer, (v) => setCorner((spec) => (spec.corner = { ...spec.corner, chamfer: Math.max(0, v) }))));
  const off = standOff(p, c);
  const auto = c.corner.standOff == null;
  fields.push(
    h(
      'label',
      { class: auto ? 'field' : 'field overridden' },
      h(
        'span',
        {},
        'Off the walls',
        auto
          ? null
          : h(
              'button',
              { class: 'reset', type: 'button', title: 'Line the fronts up again', onclick: (e) => (e.preventDefault(), setCorner((spec) => (spec.corner = { ...spec.corner, standOff: null }))) },
              '↺',
            ),
      ),
      h('input', lenInput(off, (v) => setCorner((spec) => (spec.corner = { ...spec.corner, standOff: Math.max(0, v) })), { key: 'cornerOff' })),
    ),
  );
  const std = p.construction.cabinetSizes?.[c.kind]?.depth;
  const size =
    `${fmtLen(c.width)} along this wall × ${fmtLen(c.corner.return)} along the next, ${fmtLen(c.depth)} deep, ` +
    (auto ? `${fmtLen(off)} off both walls so its fronts line up with ${fmtLen(std ?? c.depth)} deep cabinets` : `${fmtLen(off)} off both walls`);
  const door = c.corner.type === 'L' ? 'Two doors meet in the inside corner.' : `One ${fmtLenU(cornerDoors(c, con).door)} door on the 45° diagonal (use a 45° hinge plate).`;
  const where =
    loc?.kind !== 'wall'
      ? ' Corner cabinets belong at the end of a wall.'
      : next && next.wall.turn === 'inside'
        ? ` It stands in the corner with ${next.name}; that wall's run starts after its return.`
        : ' Add the next wall (inside corner) in the Plan view for its return.';
  return section('Corner', fields, `${size}. ${door}${where}`);
}

/** A space for an appliance: what it is for, its width and run, and whether the countertop runs over it. */
function spaceSection(c) {
  const p = state.project;
  const setRun = (run) => {
    const i = state.selected;
    updateProject((p) => {
      const { height, depth, elevation } = newFiller(run, 0, p.construction);
      Object.assign(p.cabinets[i], { run, height, depth, elevation });
      relayout(p);
    });
  };
  return section(
    'Space',
    [
      selectField(
        'For',
        'spacePreset',
        Object.entries(SPACE_PRESETS).map(([id, sp]) => [id, `${sp.label} (${fmtLen(spaceSize(id, state.project.construction).width)})`]),
        c.preset ?? 'space',
        (v) => {
          const sp = SPACE_PRESETS[v];
          const i = state.selected;
          updateProject((p) => {
            const spec = p.cabinets[i];
            const { width, height, depth, elevation } = newSpace(v, 0, p.construction);
            Object.assign(spec, { preset: v, run: sp.run, width, countertop: sp.countertop, height, depth, elevation, name: `${sp.label} ${spec.id}` });
            relayout(p);
          });
        },
        { wide: true },
      ),
      textField('Name', 'name', c.name, (v) => editCabinet((c) => (c.name = v)), { wide: true }),
      resizeField(c, 10),
      selectField('Run', 'run', Object.entries(RUN_LABELS), c.run, setRun),
      c.run === 'base' ? checkboxField('Countertop over it', 'spaceTop', c.countertop !== false, (on) => editCabinet((c) => (c.countertop = on))) : null,
    ],
    `Room left in the ${RUN_LABELS[c.run].toLowerCase()} run: nothing is made for it. ` +
      (c.run === 'base' ? (c.countertop !== false ? 'The countertop runs over it (a dishwasher).' : 'The countertop stops at it (a range).') : ''),
  );
}

function sizeSection(c) {
  const filler = c.kind === 'filler' || c.kind === 'space';
  return section('Size & position', [
    locationField(c),
    filler ? null : [textField('Name', 'name', c.name, (v) => editCabinet((c) => (c.name = v)), { wide: true }), c.corner ? null : resizeField(c)],
    num(c, 'Height', 'height', (c) => c.height, (c, v) => (c.height = v)),
    num(c, 'Depth', 'depth', (c) => c.depth, (c, v) => (c.depth = v)),
    num(c, 'Position X', 'x', (c) => c.x, (c, v) => (c.x = v)),
    num(c, 'Elevation', 'elevation', (c) => c.elevation, (c, v) => (c.elevation = Math.max(0, v))),
  ]);
}

function frontsSection(c) {
  return section(
    'Fronts & shelves',
    [frontStack(c)],
    'Each section is a door, a drawer or open. A stretcher or full panel under a section divides it from the next; fixed shelves are spaced evenly in their section, adjustable ones share the space between them.',
  );
}

/** A corner cabinet's doors come from its shape; only the shelves are set here. */
function cornerShelves(c) {
  return section(
    'Shelves',
    [count(c, 'Shelves', 'shelves', (c) => c.shelves, (c, v) => (c.shelves = Math.min(12, Math.max(0, Math.round(v)))))],
    'The doors follow the corner (Size & position).',
  );
}

function endPanelSwitches(c) {
  return section(
    'End panels',
    ['left', 'right'].map((side) =>
      checkboxField(`${side === 'left' ? 'Left' : 'Right'} end panel`, `endPanel-${side}`, !!c.endPanels?.[side], (on) => {
        const i = state.selected;
        updateProject((p) => {
          const spec = p.cabinets[i];
          spec.endPanels = { left: false, right: false, ...spec.endPanels, [side]: on };
          relayout(p);
        });
      }),
    ),
    'Cut from the front material and standing proud of the case front; the run makes room for them.',
  );
}

// ---- per-cabinet construction --------------------------------------------

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Sets an override, or clears it when the value matches the job's (for a
 *  filler's base: its cabinet's). */
function setOverride(path, value) {
  const baseline = jobFor(state.project, state.selected);
  changeOverrides((o) => {
    if (same(value, getPath(baseline, path))) deletePath(o, path);
    else setPath(o, path, value);
  });
}

/** Changes the selected cabinet's overrides; a change that moves its fronts
 *  (style, rails, reveals) refits its drawer-unit stack (refitFronts). */
function changeOverrides(fn) {
  const i = state.selected;
  updateProject((p) => {
    const spec = p.cabinets[i];
    if (!spec) return;
    const before = structuredClone(spec.overrides ?? {});
    spec.overrides ??= {};
    fn(spec.overrides);
    refitFronts(p, p.construction, i, before);
    // A style change can change the scribe and so where the run starts.
    relayout(p);
  });
}

/**
 * A field bound to one construction setting of the selected cabinet. It
 * shows the cabinet's effective value; when it differs from the job the
 * label is marked and a reset button returns it to the job setting.
 */
function overrideField(spec, label, path, control, { wide = false } = {}) {
  const overridden = hasPath(spec.overrides, path);
  const job = jobFor(state.project, state.selected);
  const value = getPath(effectiveConstruction(job, spec.overrides), path);
  return h(
    'label',
    { class: `field${wide ? ' wide' : ''}${overridden ? ' overridden' : ''}` },
    h(
      'span',
      {},
      label,
      overridden
        ? h(
            'button',
            {
              class: 'reset',
              type: 'button',
              title: 'Use the job setting',
              'aria-label': `Reset ${label} to the job setting`,
              onclick: (e) => {
                e.preventDefault();
                changeOverrides((o) => deletePath(o, path));
              },
            },
            '↺',
          )
        : null,
    ),
    control(value, (v) => setOverride(path, v), `ov-${path}`),
  );
}

/** A length override; `metric` keeps it in mm (drawer hardware). */
const numberControl = (min = 0, { metric = false } = {}) => (value, commit, key) =>
  h('input', lenInput(value ?? 0, (v) => commit(Math.max(min, v)), { step: 0.5, key, metric }));

const selectControl = (options, parse = (v) => v) => (value, commit, key) =>
  h(
    'select',
    { 'data-key': key, value: String(value), onchange: (e) => commit(parse(e.target.value)) },
    options.map(([v, l]) => h('option', { value: String(v) }, l)),
  );

/** Number of overridden settings (a `type` object such as `back` counts once). */
export function countOverrides(o) {
  return Object.values(o ?? {}).reduce(
    (n, v) => n + (v !== null && typeof v === 'object' && !Array.isArray(v) && !('type' in v) ? countOverrides(v) : 1),
    0,
  );
}

export const PLINTH_OPTIONS = [
  ['sides', 'Integrated Toe Kick'],
  ['frame', 'Separate Toe Kick (Plinth Frame)'],
  ['board', 'Toe Kick Board'],
  ['none', 'None'],
];

const section = (title, fields, note) =>
  fields.flat(Infinity).some(Boolean)
    ? h('section', {}, h('h3', {}, title), h('div', { class: 'fields' }, fields), note ? h('p', { class: 'muted' }, note) : null)
    : null;

function baseFields(spec, c, field) {
  if (!hasPlinth(spec)) return [];
  return [
    field('Base', 'plinth', selectControl(PLINTH_OPTIONS)),
    c.plinth === 'none' ? [] : [field('Base height', 'toeKickHeight', numberControl()), field('Base overhang', 'toeKickSetback', numberControl())],
    c.plinth === 'sides'
      ? field(
          'Toe kick cover',
          'toeKickCover',
          selectControl(
            [
              [true, 'Yes'],
              [false, 'No'],
            ],
            (v) => v === 'true',
          ),
        )
      : [],
  ];
}

// Construction settings this cabinet can change, as override sections. Each
// takes the cabinet, its effective construction and an override field.

function materialsSection(spec, c, field) {
  const options = state.project.construction.library.filter((m) => !m.edgeBand).map((m) => [m.id, materialLabel(m)]);
  const slots = spec.panel ? ['front'] : spec.kind === 'filler' ? ['front', 'case'] : ['case', 'front', 'drawerBox', ...(c.frontStyle === 'shaker' ? ['panel'] : [])];
  return section('Materials', slots.map((slot) => field(SLOT_LABELS[slot], `materials.${slot}`, selectControl(options, Number))));
}

function backSection(spec, c, field) {
  return section('Back', [
    // `back` is one setting holding both the joint type and the dado depth.
    field('Back joint', 'back', (value, commit, key) =>
      selectControl([
        ['butt', 'Butt joint'],
        ['dado', 'Dado'],
      ])(value.type, (v) => commit(v === 'dado' ? { type: 'dado', depth: 6 } : { type: 'butt' }), key),
    ),
    c.back.type === 'dado'
      ? field('Back dado depth', 'back', (value, commit, key) => numberControl()(value.depth, (v) => commit({ type: 'dado', depth: v }), `${key}-depth`))
      : null,
  ]);
}

function baseSection(spec, c, field) {
  const source = spec.kind === 'filler' && hasPlinth(spec) ? baseSource(state.project, state.selected) : null;
  return section(
    spec.kind === 'base' ? 'Base & stretchers' : 'Base',
    [baseFields(spec, c, field), spec.kind === 'base' ? field('Stretcher width', 'stretcherWidth', numberControl(30)) : null],
    source ? `Base follows ${source.name}.` : null,
  );
}

function revealsSection(spec, c, field) {
  return section('Reveals', [
    field('Side reveal', 'reveals.side', numberControl()),
    field('Gap between fronts', 'reveals.gap', numberControl()),
    field('Top reveal', 'reveals.top', numberControl()),
    field('Bottom reveal', 'reveals.bottom', numberControl()),
  ]);
}

function frontStyleOverrides(spec, c, field) {
  return section('Front style', [
    field('Doors & drawer fronts', 'frontStyle', selectControl(Object.entries(FRONT_STYLES))),
    c.frontStyle === 'shaker'
      ? [
          field('Frame width', 'shaker.frame', numberControl(10)),
          field('Rabbet width', 'shaker.rabbet', numberControl(0.5)),
          field('Panel clearance', 'shaker.clearance', numberControl()),
          field('Min. opening', 'shaker.minOpening', numberControl()),
        ]
      : null,
  ]);
}

function drawerOverrides(spec, c, field) {
  if (spec.corner || !frontSections(spec).some((sec) => sec.type === 'drawer')) return null;
  return section('Drawers', [
    field('Slide length', 'slide.length', selectControl(c.slide.lengths.map((l) => [l, `${l} mm`]), Number)),
    field('Drawer bottom raise', 'drawerBottomRaise', numberControl(0, { metric: true })),
  ]);
}

function endPanelOverrides(spec, c, field) {
  if (!(spec.panel || spec.endPanels?.left || spec.endPanels?.right)) return null;
  return section('End panel construction', [
    field('End panel overhang', 'endPanel.frontOverhang', numberControl()),
    hasPlinth(spec) && c.plinth !== 'none'
      ? field(
          'End panel toe kick',
          'endPanel.toeKick',
          selectControl(
            [
              [true, 'Notched'],
              [false, 'None (full height)'],
            ],
            (v) => v === 'true',
          ),
        )
      : null,
  ]);
}

function styleOverrides(spec, c, field) {
  if (spec.kind === 'filler' || spec.kind === 'space' || spec.panel) return null;
  const ff = isFaceFrame(c);
  return section(
    'Cabinet style',
    [
      field('Style', 'cabinetStyle', selectControl(Object.entries(CABINET_STYLES)), { wide: true }),
      isInset(c) ? field('Gap around inset fronts', 'insetGap', numberControl()) : null,
      c.cabinetStyle === 'faceFrameOverlay' ? field('Overlay onto the frame', 'frameOverlay', numberControl()) : null,
      ff
        ? [
            field('Top rail', 'faceFrame.topRail', numberControl(10)),
            field('Bottom rail', 'faceFrame.bottomRail', numberControl(10)),
            field('Rails between fronts', 'faceFrame.midRail', numberControl(5)),
            field('Joints', 'faceFrame.joinery', selectControl(Object.entries(JOINERY))),
            field('Wood', 'faceFrame.wood', selectControl((state.project.construction.woods ?? []).map((w) => [w.id, w.name]), Number)),
          ]
        : null,
    ],
    spec.corner && ff ? 'Corner cabinets (L and 45°) are built frameless; use a blind corner in a face-frame run.' : null,
  );
}

/** The face frame break after this cabinet, and a blind corner's blind part. */
function frameSection(c) {
  const con = effectiveConstruction(jobFor(state.project, state.selected), c.overrides);
  const ff = isFaceFrame(con) && !c.corner;
  const blind = c.blind
    ? [
        lenField('Blind part', 'blindWidth', c.blind.width, (v) =>
          updateProject((p) => {
            const spec = p.cabinets[state.selected];
            spec.blind = { ...spec.blind, width: Math.max(0, v) };
            relayout(p);
          }),
        ),
        h(
          'button',
          {
            type: 'button',
            title: "The next wall's cabinet depth and fronts plus the clearance (Settings → Corner cabinets)",
            onclick: () =>
              updateProject((p) => {
                const spec = p.cabinets[state.selected];
                spec.blind = { ...spec.blind, width: Math.round(blindDepth(effectiveConstruction(jobFor(p, state.selected), spec.overrides), spec.kind)) };
                relayout(p);
              }),
          },
          'Size from the next wall',
        ),
      ]
    : null;
  const fields = [
    ff
      ? checkboxField('Break the frame after this cabinet', 'frameBreak', !!c.frameBreak, (on) =>
          editCabinet((spec) => {
            if (on) spec.frameBreak = true;
            else delete spec.frameBreak;
          }),
        )
      : null,
    blind,
  ];
  const notes = [
    ff ? 'The face frame runs on into the next cabinet unless it breaks here; each side of a break gets its own stile.' : null,
    c.blind ? `The blind part, from the corner end, is covered by ${ff ? 'a wide stile' : 'a blind panel'}; the next wall's cabinets stand in front of it.` : null,
  ].filter(Boolean);
  return section(c.blind ? 'Blind corner' : 'Face frame', fields, notes.join(' ') || null);
}

const OVERRIDE_NOTE = 'These start from the job settings (gear button); a change applies to this cabinet only, is highlighted and has a ↺ reset.';

/**
 * The dialog's pages. `own` builds the cabinet's own sections, `overrides`
 * its construction sections; `paths` are the overrides a page holds, for
 * its badge.
 */
const CABINET_PAGES = [
  { id: 'size', label: 'Size & position', own: (c) => [sizeSection(c), c.corner ? cornerSection(c) : null] },
  { id: 'fronts', label: 'Fronts & shelves', own: (c) => [c.corner ? cornerShelves(c) : frontsSection(c)], overrides: [revealsSection, frontStyleOverrides, drawerOverrides], paths: ['reveals', 'frontStyle', 'shaker', 'slide', 'drawerBottomRaise'] },
  { id: 'style', label: 'Style & frame', own: (c) => [frameSection(c)], overrides: [styleOverrides], paths: ['cabinetStyle', 'insetGap', 'frameOverlay', 'faceFrame'] },
  { id: 'case', label: 'Case & base', overrides: [backSection, baseSection], paths: ['back', 'plinth', 'toeKickHeight', 'toeKickSetback', 'toeKickCover', 'stretcherWidth'] },
  { id: 'materials', label: 'Materials', overrides: [materialsSection], paths: ['materials'] },
  { id: 'endPanels', label: 'End panels', own: (c) => [endPanelSwitches(c)], overrides: [endPanelOverrides], paths: ['endPanel'], when: (spec) => !spec.corner },
];
const SPACE_PAGES = [{ id: 'size', label: 'Space', own: (c) => [spaceSection(c), sizeSection(c)] }];
const FILLER_PAGES = [
  { id: 'size', label: 'Filler', own: (c) => [fillerSection(c), sizeSection(c)] },
  { id: 'materials', label: 'Materials', overrides: [materialsSection], paths: ['materials'] },
  { id: 'case', label: 'Base', overrides: [baseSection], paths: ['plinth', 'toeKickHeight', 'toeKickSetback', 'toeKickCover'], when: (spec) => hasPlinth(spec) },
];
const PANEL_PAGES = [
  { id: 'size', label: 'Panel', own: (c) => [fillerSection(c), sizeSection(c)] },
  { id: 'materials', label: 'Materials', overrides: [materialsSection], paths: ['materials'] },
  { id: 'case', label: 'Base', overrides: [baseSection], paths: ['plinth', 'toeKickHeight', 'toeKickSetback', 'toeKickCover'], when: (spec) => hasPlinth(spec) },
  { id: 'endPanels', label: 'End panel', overrides: [endPanelOverrides], paths: ['endPanel'] },
];

/** Overrides under `paths` (see countOverrides). */
function countPaths(overrides, paths) {
  return paths.reduce((n, path) => {
    if (!hasPath(overrides, path)) return n;
    const v = getPath(overrides, path);
    return n + (v !== null && typeof v === 'object' && !Array.isArray(v) && !('type' in v) ? countOverrides(v) : 1);
  }, 0);
}

function pageContent(spec, page) {
  const c = effectiveConstruction(jobFor(state.project, state.selected), spec.overrides);
  const field = (label, path, control, opts) => overrideField(spec, label, path, control, opts);
  const overrides = (page.overrides ?? []).map((make) => make(spec, c, field)).filter(Boolean);
  const error = state.built[state.selected]?.error;
  return [
    h('h2', {}, page.label),
    error ? h('div', { class: 'error' }, error) : null,
    page.own?.(spec),
    page.id === 'size' ? sizeReference() : null,
    overrides.length ? [h('p', { class: 'muted override-note' }, OVERRIDE_NOTE), overrides] : null,
  ];
}

// ---- dialog ------------------------------------------------------------------

// Older page names, still used to open the dialog.
const PAGE_ALIASES = { cabinet: 'size', construction: 'materials' };

export function renderCabinetDialog(container) {
  const spec = state.project.cabinets[state.selected];
  if (!state.cabDialog || !spec) {
    container.replaceChildren();
    return;
  }
  const n = state.project.cabinets.length;
  const i = state.selected;
  const count = countOverrides(spec.overrides);
  const pages = (spec.kind === 'space' ? SPACE_PAGES : spec.panel ? PANEL_PAGES : spec.kind === 'filler' ? FILLER_PAGES : CABINET_PAGES).filter((p) => !p.when || p.when(spec));
  // Stepping to a cabinet without the open page (a filler has no fronts) shows its first.
  const id = PAGE_ALIASES[state.cabDialog] ?? state.cabDialog;
  const page = pages.find((p) => p.id === id) ?? pages[0];
  const link = (p) => {
    const k = p.paths ? countPaths(spec.overrides, p.paths) : 0;
    return h(
      'button',
      { class: p === page ? 'active' : null, 'aria-current': p === page ? 'page' : null, onclick: () => setState({ cabDialog: p.id }) },
      p.label,
      k ? h('span', { class: 'badge', title: `${k} changed from the job settings` }, String(k)) : null,
    );
  };
  mount(
    container,
    h(
      'div',
      { class: 'modal-backdrop', onclick: close },
      h(
        'div',
        {
          class: 'modal large settings-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': spec.name,
          onclick: (e) => e.stopPropagation(),
        },
        h(
          'header',
          { class: 'modal-head' },
          h(
            'div',
            { class: 'cab-nav' },
            h('button', { class: 'icon-btn', 'aria-label': 'Previous cabinet', disabled: i <= 0, onclick: () => select(i - 1) }, '‹'),
            h(
              'select',
              { 'aria-label': 'Cabinet', 'data-key': 'cab-nav', value: String(i), onchange: (e) => select(Number(e.target.value)) },
              state.project.cabinets.map((c, k) => h('option', { value: String(k) }, c.name)),
            ),
            h('button', { class: 'icon-btn', 'aria-label': 'Next cabinet', disabled: i >= n - 1, onclick: () => select(i + 1) }, '›'),
          ),
          h('div', { class: 'spacer' }),
          h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕'),
        ),
        h(
          'div',
          { class: 'settings-layout' },
          h(
            'nav',
            { class: 'settings-nav', 'aria-label': 'Cabinet sections' },
            h('div', { class: 'settings-nav-group' }, h('h4', {}, spec.panel ? 'Panel' : spec.kind === 'filler' ? 'Filler' : spec.kind === 'space' ? 'Space' : 'Cabinet'), pages.map(link)),
            count
              ? h(
                  'div',
                  { class: 'settings-nav-foot' },
                  h('button', { onclick: () => editCabinet((spec) => delete spec.overrides), title: 'Use the job settings everywhere' }, `Reset ${count} to job settings`),
                )
              : null,
          ),
          h('div', { class: 'settings-content' }, h('div', { class: 'settings-page' }, pageContent(spec, page))),
        ),
      ),
    ),
  );
}
