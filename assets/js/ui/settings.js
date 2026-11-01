// Settings dialog behind the gear button: the material library and the
// job's construction standards.

import {
  EDGE_BAND_KIND,
  FRONT_STYLES,
  MATERIAL_KINDS,
  SLOTS,
  SLOT_LABELS,
  SPACE_PRESETS,
  defaultConstruction,
  bandLabel,
  caseT,
  defaultSheetSize,
  ensureBands,
  fmtMm,
  materialLabel,
  newMaterial,
  nextMaterialId,
  spaceSize,
  unitFrontHeight,
  usStandardSizes,
} from '../engine/model.js';
import { hingeBoring } from '../engine/build.js';
import { cornerDoors, newCorner } from '../engine/corner.js';
import { BAND_PARTS, EDGES } from '../engine/part.js';
import { PAINT_GROUPS } from '../engine/paint.js';
import { PLINTH_OPTIONS } from './cabinetdialog.js';
import { checkboxField, h, lenField, lenInput, mount, numField, selectField, sizeReference, textField } from './dom.js';
import { PRECISIONS, fmtLen, fmtLenU, isImperial, parseLen, rateToMm, rateValue, unitName } from '../engine/units.js';
import { setPrefs, setShop, setState, state, updateProject } from './store.js';

const close = () => setState({ settings: null });

function editConstruction(fn, opts) {
  updateProject((p) => fn(p.construction), opts);
}

function editMaterial(id, fn, opts) {
  editConstruction((c) => {
    const m = c.library.find((m) => m.id === id);
    if (m) fn(m);
  }, opts);
}

/** Price input for a library material: per sheet, or per metre of band. */
function costCell(m, key, label) {
  return h(
    'td',
    { class: 'num' },
    h('input', {
      type: 'number',
      step: 0.01,
      min: 0,
      'aria-label': label,
      'data-key': key('cost'),
      value: m.cost ? m.cost.toFixed(2) : '',
      placeholder: '0.00',
      onchange: (e) => {
        const v = e.target.value.trim() === '' ? 0 : parseFloat(e.target.value);
        if (Number.isFinite(v)) editMaterial(m.id, (m) => (m.cost = Math.max(0, v)));
      },
    }),
  );
}

function materialRow(m, c) {
  const usedFor = SLOTS.filter((s) => c.materials[s] === m.id).map((s) => SLOT_LABELS[s]);
  const key = (f) => `m${m.id}-${f}`;
  // Thickness stays in mm (sheet goods are sold by metric thickness); the
  // sheet size follows the display units.
  const num = (label, field, min, { step = 0.5, metric = false } = {}) =>
    h(
      'td',
      { class: 'num' },
      h('input', lenInput(m[field], (v) => editMaterial(m.id, (m) => (m[field] = Math.max(min, v))), { metric, step, key: key(field), 'aria-label': label })),
    );
  return h(
    'tr',
    {},
    h(
      'td',
      {},
      h('input', {
        type: 'color',
        'aria-label': 'Colour',
        'data-key': key('color'),
        value: m.color,
        // Live preview while dragging; the dialog itself is left alone so
        // the colour picker stays open.
        oninput: (e) => editMaterial(m.id, (m) => (m.color = e.target.value), { skipSettings: true }),
      }),
    ),
    h(
      'td',
      {},
      h('input', {
        'aria-label': 'Name',
        'data-key': key('name'),
        value: m.name,
        onchange: (e) => editMaterial(m.id, (m) => (m.name = e.target.value)),
      }),
    ),
    h(
      'td',
      {},
      h(
        'select',
        {
          'aria-label': 'Type',
          'data-key': key('kind'),
          value: m.kind,
          onchange: (e) =>
            editMaterial(m.id, (m) => {
              // Follow the new type's stock size unless the size was customised.
              const [l, w] = defaultSheetSize(m.kind);
              const same = (a, b) => Math.abs(a - b) < 0.05;
              if (same(m.sheetLength, l) && same(m.sheetWidth, w)) [m.sheetLength, m.sheetWidth] = defaultSheetSize(e.target.value);
              m.kind = e.target.value;
            }),
        },
        MATERIAL_KINDS.filter((k) => k !== EDGE_BAND_KIND).map((k) => h('option', { value: k }, k)),
      ),
    ),
    num('Thickness', 'thickness', 1, { metric: true }),
    num('Sheet length', 'sheetLength', 100),
    num('Sheet width', 'sheetWidth', 100),
    costCell(m, key, 'Cost per sheet'),
    h(
      'td',
      {},
      h('input', {
        type: 'checkbox',
        'aria-label': 'Has grain',
        'data-key': key('grain'),
        checked: m.grain,
        onchange: (e) => editMaterial(m.id, (m) => (m.grain = e.target.checked)),
      }),
    ),
    h('td', { class: 'used' }, usedFor.join(', ')),
    h(
      'td',
      {},
      h(
        'button',
        {
          class: 'danger',
          disabled: usedFor.length > 0,
          title: usedFor.length ? 'In use: pick another material under Construction first' : 'Delete material',
          onclick: () => editConstruction((c) => (c.library = c.library.filter((x) => x.id !== m.id))),
        },
        'Delete',
      ),
    ),
  );
}

function materialLibrary(c) {
  const add = () =>
    editConstruction((c) => c.library.push(newMaterial(nextMaterialId(c), 'New material', 'Melamine', 16, '#cccccc')));
  return h(
    'section',
    {},
    h('h3', {}, 'Sheet library'),
    h('p', { class: 'muted' }, 'Sheet materials available to every job. Edge bands are under Edge banding.'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'library' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ['Colour', 'Name', 'Type'].map((t) => h('th', {}, t)),
            [isImperial() ? 'Thickness (mm)' : 'Thickness', 'Sheet L', 'Sheet W', '$ / sheet'].map((t) => h('th', { class: 'num' }, t)),
            ['Grain', 'Used for', ''].map((t) => h('th', {}, t)),
          ),
        ),
        h(
          'tbody',
          {},
          c.library.filter((m) => !m.edgeBand).map((m) => materialRow(m, c)),
        ),
      ),
    ),
    h('div', { class: 'add-row', style: { marginTop: '10px' } }, h('button', { class: 'primary', onclick: add }, '+ Add material')),
  );
}

// ---- edge banding page -------------------------------------------------------

/** One edge band roll: colour, name, band type, thickness. */
function bandRow(m, c) {
  const usedFor = Object.entries(BAND_PARTS)
    .filter(([group]) => c.partBands?.[group] === m.id)
    .map(([, { label }]) => label);
  const key = (f) => `b${m.id}-${f}`;
  return h(
    'tr',
    {},
    h(
      'td',
      {},
      h('input', {
        type: 'color',
        'aria-label': 'Colour',
        'data-key': key('color'),
        value: m.color,
        oninput: (e) => editMaterial(m.id, (m) => (m.color = e.target.value), { skipSettings: true }),
      }),
    ),
    h('td', {}, h('input', { 'aria-label': 'Name', 'data-key': key('name'), value: m.name, onchange: (e) => editMaterial(m.id, (m) => (m.name = e.target.value)) })),
    h(
      'td',
      {},
      h(
        'select',
        { 'aria-label': 'Band type', 'data-key': key('type'), value: m.bandType, onchange: (e) => editMaterial(m.id, (m) => (m.bandType = e.target.value)) },
        c.edgeBandTypes.map((bt) => h('option', { value: bt }, bt)),
      ),
    ),
    h(
      'td',
      { class: 'num' },
      h('input', {
        type: 'number',
        step: 0.1,
        'aria-label': 'Thickness',
        'data-key': key('thickness'),
        value: fmtMm(m.thickness),
        onchange: (e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) editMaterial(m.id, (m) => (m.thickness = Math.max(0.1, v)));
        },
      }),
    ),
    costCell(m, key, 'Cost per metre'),
    h('td', { class: 'used' }, usedFor.join(', ')),
    h(
      'td',
      {},
      h(
        'button',
        {
          class: 'danger',
          disabled: usedFor.length > 0,
          title: usedFor.length ? 'In use: pick another band for those parts below first' : 'Delete edge band',
          onclick: () =>
            editConstruction((c) => {
              c.library = c.library.filter((x) => x.id !== m.id);
              ensureBands(c);
            }),
        },
        'Delete',
      ),
    ),
  );
}

function bandLibrary(c) {
  const add = () =>
    editConstruction((c) =>
      c.library.push({ ...newMaterial(nextMaterialId(c), 'New edge band', EDGE_BAND_KIND, 1, '#cccccc'), bandType: c.edgeBandTypes[0] }),
    );
  return h(
    'section',
    {},
    h('h3', {}, 'Edge bands'),
    h('p', { class: 'muted' }, 'Banding rolls available to every job. The thickness is taken off the cut size of each banded edge; the price per metre goes into the Materials cost.'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'library' },
        h(
          'thead',
          {},
          h('tr', {}, ['Colour', 'Name', 'Type'].map((t) => h('th', {}, t)), [isImperial() ? 'Thickness (mm)' : 'Thickness', '$ / m'].map((t) => h('th', { class: 'num' }, t)), h('th', {}, 'Used for'), h('th', {})),
        ),
        h('tbody', {}, c.library.filter((m) => m.edgeBand).map((m) => bandRow(m, c))),
      ),
    ),
    h('div', { class: 'add-row', style: { marginTop: '10px' } }, h('button', { class: 'primary', onclick: add }, '+ Add edge band')),
  );
}

/** The configurable list of edge band types (PVC, ABS, veneer…). */
function bandTypeList(c) {
  const usage = (bt) => c.library.filter((m) => m.edgeBand && m.bandType === bt).length;
  const rename = (i, value) => {
    const name = value.trim();
    editConstruction((c) => {
      const old = c.edgeBandTypes[i];
      // Empty or a duplicate: keep the old name (the re-render restores it).
      if (!name || (name !== old && c.edgeBandTypes.includes(name))) return;
      c.edgeBandTypes[i] = name;
      for (const m of c.library) if (m.edgeBand && m.bandType === old) m.bandType = name;
    });
  };
  const add = () =>
    editConstruction((c) => {
      let n = 1;
      while (c.edgeBandTypes.includes(`New type ${n}`)) n++;
      c.edgeBandTypes.push(`New type ${n}`);
    });
  return h(
    'section',
    {},
    h('h3', {}, 'Edge band types'),
    h('p', { class: 'muted' }, 'The kinds of edge band you use; each band above is one of them.'),
    h(
      'table',
      { class: 'library band-type-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Used by'), h('th', {}))),
      h(
        'tbody',
        {},
        c.edgeBandTypes.map((bt, i) => {
          const n = usage(bt);
          return h(
            'tr',
            {},
            h('td', {}, h('input', { 'aria-label': 'Edge band type', 'data-key': `bt-${i}`, value: bt, onchange: (e) => rename(i, e.target.value) })),
            h('td', { class: 'used' }, n ? `${n} band${n === 1 ? '' : 's'}` : ''),
            h(
              'td',
              {},
              h(
                'button',
                {
                  class: 'danger',
                  disabled: n > 0 || c.edgeBandTypes.length === 1,
                  title: n ? 'In use: change those bands to another type first' : 'Delete type',
                  onclick: () => editConstruction((c) => c.edgeBandTypes.splice(i, 1)),
                },
                'Delete',
              ),
            ),
          );
        }),
      ),
    ),
    h('div', { class: 'add-row', style: { marginTop: '8px' } }, h('button', { onclick: add }, '+ Add type')),
  );
}

/** A length setting (mm), shown in the display units unless `metric`. */
function conNum(c, label, key, get, set, { metric = false } = {}) {
  return lenField(label, key, get(c), (v) => editConstruction((c) => set(c, v)), { step: 0.5, metric });
}

/** A section heading; hardware sections stay in mm and say so in inch mode. */
const metricHeading = (text) => h('h3', {}, isImperial() ? `${text} (mm)` : text);

/** A price in the construction (0 = not priced). */
function conCost(c, label, key, get, set) {
  return numField(label, key, get(c) || 0, (v) => editConstruction((c) => set(c, Math.max(0, v))), { step: 0.01, format: (v) => v.toFixed(2) });
}

/** The undermount slides: length, price and what they mean for the drawer. */
function slideSection(c) {
  const sl = c.slide;
  return h(
    'section',
    {},
    metricHeading('Slides'),
    h(
      'div',
      { class: 'fields' },
      selectField(
        'Slide length',
        'slideLength',
        sl.lengths.map((l) => [l, `${l} mm → drawer ${l - sl.drawerLengthDeduction} mm`]),
        sl.length,
        (v) => editConstruction((c) => (c.slide.length = Number(v))),
        { wide: true },
      ),
      conCost(c, '$ / pair of slides', 'slideCost', (c) => c.slide.cost, (c, v) => (c.slide.cost = v)),
    ),
    h(
      'p',
      { class: 'muted' },
      `${sl.name}: drawer length = slide − ${sl.drawerLengthDeduction}, inside width = cabinet inside − ${sl.insideWidthDeduction}, ` +
        `drawer material up to ${fmtMm(sl.maxSideThickness)} mm. Shallow cabinets use the longest slide that fits. ` +
        `Slide screw holes are drilled in both sides ${sl.holeHeights.join(' and ')} mm above the base of each slide.`,
    ),
  );
}

/** Drawer box side heights, bottom raise and clearance under the front. */
function drawerBoxSection(c) {
  const setHeights = (text) => {
    const heights = [...new Set(text.split(/[,\s]+/).map(Number).filter((v) => v > 0))].sort((a, b) => a - b);
    if (heights.length) editConstruction((c) => (c.drawerSideHeights = heights));
    else setState({}); // re-render to restore the last valid list
  };
  return h(
    'section',
    {},
    metricHeading('Drawer boxes'),
    h(
      'div',
      { class: 'fields' },
      textField('Side heights', 'sideHeights', c.drawerSideHeights.join(', '), setHeights),
      conNum(c, 'Bottom raise', 'bottomRaise', (c) => c.drawerBottomRaise, (c, v) => (c.drawerBottomRaise = Math.max(0, v)), { metric: true }),
      conNum(c, 'Front − side clearance', 'frontClear', (c) => c.drawerFrontClearance, (c, v) => (c.drawerFrontClearance = Math.max(0, v)), { metric: true }),
    ),
    h(
      'p',
      { class: 'muted' },
      'Equal-height drawers get the tallest side height that fits under the front less the clearance; drawers in units take ' +
        'the box their size names (Drawer sizes below). The bottom is raised this far for the slide runners.',
    ),
  );
}

/** Drawer sizes in units: each front height and the drawer box it takes. */
function drawerSizeSection(c) {
  const sizes = [...c.drawerSizes].sort((a, b) => a.units - b.units);
  // The tallest side height that fits behind a front `units` tall.
  const autoBox = (c, units) => {
    const fits = c.drawerSideHeights.filter((ht) => ht <= unitFrontHeight(c, units) - c.drawerFrontClearance);
    return fits.length ? Math.max(...fits) : Math.min(...c.drawerSideHeights);
  };
  const edit = (units, fn) =>
    editConstruction((c) => {
      const row = c.drawerSizes.find((s) => s.units === units);
      if (row) fn(row, c);
      c.drawerSizes.sort((a, b) => a.units - b.units);
    });
  const setUnits = (units, v) =>
    edit(units, (row, c) => {
      const u = Math.round(v);
      if (u >= 1 && !c.drawerSizes.some((s) => s.units === u)) row.units = u;
    });
  const add = () =>
    editConstruction((c) => {
      const units = c.drawerSizes.length ? Math.max(...c.drawerSizes.map((s) => s.units)) + 1 : 5;
      c.drawerSizes.push({ units, box: autoBox(c, units) });
    });
  return h(
    'section',
    {},
    metricHeading('Drawer sizes'),
    h(
      'div',
      { class: 'fields' },
      conNum(c, 'Unit', 'drawerUnit', (c) => c.drawerUnit, (c, v) => (c.drawerUnit = Math.max(1, v)), { metric: true }),
      numField('Top drawer', 'drawerTopUnits', c.drawerTopUnits, (v) => editConstruction((c) => (c.drawerTopUnits = Math.max(0, Math.round(v))))),
    ),
    h(
      'p',
      { class: 'muted' },
      `Front = units × ${fmtMm(c.drawerUnit)} − ${fmtMm(c.reveals.gap)} mm gap. Box is the drawer side height each size takes. ` +
        `New stacks of 3 or more drawers start with a ${c.drawerTopUnits}-unit top drawer (0 = all equal), the rest sharing what's left.`,
    ),
    h(
      'table',
      { class: 'library drawer-size-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Units'), h('th', {}, 'Front'), h('th', {}, 'Box'), h('th', {}))),
      h(
        'tbody',
        {},
        sizes.map((row) =>
          h(
            'tr',
            {},
            h(
              'td',
              { class: 'num' },
              h('input', { type: 'number', min: 1, step: 1, 'aria-label': 'Units', 'data-key': `du-${row.units}`, value: row.units, onchange: (e) => setUnits(row.units, Number(e.target.value)) }),
            ),
            h('td', { class: 'used' }, `${fmtMm(unitFrontHeight(c, row.units))} mm`),
            h(
              'td',
              { class: 'num' },
              h('input', {
                type: 'number',
                min: 1,
                step: 1,
                'aria-label': 'Drawer box height',
                'data-key': `db-${row.units}`,
                value: row.box,
                onchange: (e) => edit(row.units, (r) => (r.box = Math.max(1, Number(e.target.value) || r.box))),
              }),
            ),
            h(
              'td',
              {},
              h(
                'button',
                {
                  class: 'danger',
                  title: 'Delete size',
                  'aria-label': `Delete the ${row.units}-unit size`,
                  onclick: () => editConstruction((c) => (c.drawerSizes = c.drawerSizes.filter((s) => s.units !== row.units))),
                },
                '×',
              ),
            ),
          ),
        ),
      ),
    ),
    h('div', { class: 'add-row', style: { marginTop: '8px' } }, h('button', { onclick: add }, '+ Add size')),
  );
}

function hingeSection(c) {
  const hg = c.hinge;
  const [kMin, kMax] = hg.kRange;
  const b = hingeBoring(c);
  const setPlates = (text) => {
    const plates = [...new Set(text.split(/[,\s]+/).filter(Boolean).map(Number).filter((v) => v >= 0))].sort((a, b) => a - b);
    if (plates.length) editConstruction((c) => (c.hinge.plateHeights = plates));
    else setState({}); // re-render to restore the last valid list
  };
  return h(
    'section',
    {},
    metricHeading('Cup boring & plates'),
    h(
      'div',
      { class: 'fields' },
      selectField(
        'Cup boring',
        'hingeBoring',
        [
          ['auto', 'From door thickness'],
          ['manual', 'Fixed K'],
        ],
        hg.boring,
        (v) => editConstruction((c) => (c.hinge.boring = v)),
        { wide: true },
      ),
      conNum(c, hg.boring === 'manual' ? 'K (edge to cup)' : 'Preferred K', 'hingeK', (c) => c.hinge.k, (c, v) => (c.hinge.k = Math.min(Math.max(v, kMin), kMax)), { metric: true }),
      textField('Plate heights', 'plateHeights', hg.plateHeights.join(', '), setPlates),
      conNum(c, 'Cup depth', 'cupDepth', (c) => c.hinge.cupDepth, (c, v) => (c.hinge.cupDepth = Math.max(1, v)), { metric: true }),
      conNum(c, 'Hinge from door end', 'hingeEnd', (c) => c.hinge.endOffset, (c, v) => (c.hinge.endOffset = Math.max(hg.cupDiameter, v)), { metric: true }),
      conCost(c, '$ / hinge', 'hingeCost', (c) => c.hinge.cost, (c, v) => (c.hinge.cost = v)),
      conCost(c, '$ / plate', 'plateCost', (c) => c.hinge.plateCost, (c, v) => (c.hinge.plateCost = v)),
    ),
    h(
      'p',
      { class: 'muted' },
      `${hg.name}: ${fmtMm(b.doorThickness)} mm doors overlaying the ${fmtMm(caseT(c))} mm sides by ${fmtMm(b.overlay)} mm → ` +
        `K ${fmtMm(b.k)}, cups Ø${fmtMm(hg.cupDiameter)} × ${fmtMm(hg.cupDepth)} centred ${fmtMm(b.cupCenter)} mm from the hinge edge, ` +
        `${fmtMm(b.plate)} mm plates. K runs ${kMin}–${kMax}; thicker doors need a smaller K to clear the case when they open.`,
    ),
    b.issues.map((t) => h('p', { class: 'error' }, t)),
  );
}

function endPanelSection(c) {
  const ep = c.endPanel;
  const num = (label, key, field, min = 0) =>
    conNum(c, label, key, (c) => c.endPanel[field], (c, v) => (c.endPanel[field] = Math.max(min, v)));
  return h(
    'section',
    {},
    h('h3', {}, 'End panels'),
    h(
      'div',
      { class: 'fields' },
      num('Front overhang', 'epFront', 'frontOverhang'),
      num('Rear scribe', 'epRear', 'rearScribe'),
      num('Floor scribe', 'epFloor', 'floorScribe'),
      checkboxField('Toe-kick notch', 'epToe', ep.toeKick, (on) => editConstruction((c) => (c.endPanel.toeKick = on))),
      ep.toeKick ? num('Notch depth', 'epToeDepth', 'toeKickDepth', 1) : null,
    ),
    h(
      'p',
      { class: 'muted' },
      `Cut from the front material. Depth = case + ${fmtLen(ep.frontOverhang)} + ${fmtLen(ep.rearScribe)} scribe; ` +
        `base and tall panels are ${fmtLen(ep.floorScribe)} taller for scribing to the floor` +
        (ep.toeKick ? ` and notched ${fmtLen(ep.toeKickDepth)} deep × (base height + ${fmtLen(ep.floorScribe)}) for the toe kick.` : '.') +
        ' Turn them on per cabinet.',
    ),
  );
}

function edgeBandingSection(c) {
  const bands = c.library.filter((m) => m.edgeBand);
  const bandSelect = (group) =>
    h(
      'select',
      {
        'aria-label': `${BAND_PARTS[group].label} band`,
        'data-key': `partband-${group}`,
        value: String(c.partBands?.[group] ?? ''),
        onchange: (e) => editConstruction((c) => (c.partBands = { ...c.partBands, [group]: Number(e.target.value) })),
      },
      bands.map((m) => h('option', { value: String(m.id) }, bandLabel(m))),
    );
  const edge = (group, key, label) =>
    h(
      'td',
      {},
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'checkbox',
          'data-key': `band-${group}-${key}`,
          checked: !!c.edgeBanding[group]?.[key],
          onchange: (e) => editConstruction((c) => (c.edgeBanding[group] = { ...EDGES.none(), ...c.edgeBanding[group], [key]: e.target.checked })),
        }),
        label,
      ),
    );
  return h(
    'section',
    {},
    h('h3', {}, 'Banding on parts'),
    h(
      'p',
      { class: 'muted' },
      'Pick the band for each part type and tick the edges that get it. Parts are cut smaller by the band thickness on those ' +
        'edges, and the cut list totals the banding for the job by band.',
    ),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'band-table' },
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}, 'Part'), h('th', {}, 'Band'), h('th', { colspan: 2 }, 'Long edges (L1, L2)'), h('th', { colspan: 2 }, 'Short edges (W1, W2)')),
        ),
        h(
          'tbody',
          {},
          Object.entries(BAND_PARTS).map(([group, { label, edges }]) =>
            h('tr', {}, h('td', {}, label), h('td', {}, bandSelect(group)), ['l1', 'l2', 'w1', 'w2'].map((key) => edge(group, key, edges[key]))),
          ),
        ),
      ),
    ),
  );
}

const SIZE_KINDS = [
  ['base', 'Base'],
  ['wall', 'Wall'],
  ['tall', 'Tall'],
];

/** Width, box height and depth for cabinets added to the job. */
function cabinetSizesSection(c) {
  const toe = c.plinth !== 'none' ? c.toeKickHeight : 0;
  const set = (kind, field, min) => (v) => editConstruction((c) => (c.cabinetSizes[kind] = { ...c.cabinetSizes[kind], [field]: Math.max(min, v) }));
  const cell = (kind, field, min) =>
    h(
      'td',
      { class: 'num' },
      h('input', lenInput(c.cabinetSizes[kind][field], set(kind, field, min), { key: `size-${kind}-${field}`, 'aria-label': `${kind} ${field}` })),
    );
  return h(
    'section',
    {},
    h('h3', {}, 'New cabinet sizes'),
    h(
      'table',
      { class: 'library size-table' },
      h(
        'thead',
        {},
        h('tr', {}, h('th', {}, 'Cabinet'), ['Width', 'Box height', 'Depth', 'Overall height'].map((t) => h('th', { class: 'num' }, t))),
      ),
      h(
        'tbody',
        {},
        SIZE_KINDS.map(([kind, label]) => {
          const floor = kind !== 'wall';
          return h(
            'tr',
            {},
            h('td', {}, label),
            cell(kind, 'width', 100),
            cell(kind, 'boxHeight', 100),
            cell(kind, 'depth', 100),
            h(
              'td',
              { class: 'num used' },
              floor && toe ? `${fmtLen(c.cabinetSizes[kind].boxHeight + toe)} (+${fmtLen(toe)} toe kick)` : fmtLen(c.cabinetSizes[kind].boxHeight),
            ),
          );
        }),
      ),
    ),
    h(
      'p',
      { class: 'muted' },
      'Used for cabinets you add from now on; cabinets already in the job keep their sizes. Box height is the case alone: base and ' +
        'tall cabinets stand on the toe kick, which adds to the overall height. Depth excludes the doors.',
    ),
    sizeReference(),
  );
}

/** Sizes new spaces (appliances) start at; a blank height or depth takes the run's. */
function spaceSizesSection(c) {
  const cell = (preset, field) => {
    const own = c.spaceSizes?.[preset]?.[field] || 0;
    const run = spaceSize(preset, { ...c, spaceSizes: {} })[field];
    return h(
      'td',
      { class: 'num' },
      h('input', {
        ...lenInput(own, () => {}, { key: `space-${preset}-${field}`, 'aria-label': `${SPACE_PRESETS[preset].label} ${field}` }),
        value: own ? (isImperial() ? fmtLen(own) : fmtMm(own)) : '',
        placeholder: isImperial() ? fmtLen(run) : fmtMm(run),
        onchange: (e) => {
          const v = e.target.value.trim() === '' ? 0 : isImperial() ? parseLen(e.target.value) : parseFloat(e.target.value);
          if (Number.isFinite(v)) editConstruction((c) => (c.spaceSizes = { ...c.spaceSizes, [preset]: { ...c.spaceSizes?.[preset], [field]: Math.max(0, v) } }));
          else setState({});
        },
      }),
    );
  };
  return h(
    'section',
    {},
    h('h3', {}, 'Appliance spaces'),
    h(
      'table',
      { class: 'library size-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Space'), ['Width', 'Height', 'Depth'].map((t) => h('th', { class: 'num' }, t)))),
      h(
        'tbody',
        {},
        Object.entries(SPACE_PRESETS).map(([preset, sp]) => h('tr', {}, h('td', {}, sp.label), cell(preset, 'width'), cell(preset, 'height'), cell(preset, 'depth'))),
      ),
    ),
    h(
      'p',
      { class: 'muted' },
      'The size a space from + Other starts at; each one can change its own in its options. A blank height or depth is its run’s ' +
        '(base for the dishwasher and range, tall for the fridge).',
    ),
  );
}

/** Reveals and gaps around the fronts, and when doors become a pair. */
function frontsSection(c) {
  return h(
    'section',
    {},
    h('h3', {}, 'Fronts & reveals'),
    h(
      'div',
      { class: 'fields' },
      conNum(c, 'Side reveal', 'revSide', (c) => c.reveals.side, (c, v) => (c.reveals.side = Math.max(0, v))),
      conNum(c, 'Gap between fronts', 'revGap', (c) => c.reveals.gap, (c, v) => (c.reveals.gap = Math.max(0, v))),
      conNum(c, 'Top reveal', 'revTop', (c) => c.reveals.top, (c, v) => (c.reveals.top = Math.max(0, v))),
      conNum(c, 'Bottom reveal', 'revBottom', (c) => c.reveals.bottom, (c, v) => (c.reveals.bottom = Math.max(0, v))),
      conNum(c, 'Max single door', 'maxDoor', (c) => c.maxSingleDoorWidth, (c, v) => (c.maxSingleDoorWidth = v)),
    ),
    h('p', { class: 'muted' }, 'Full-overlay fronts. Doors wider than the max single door become a pair.'),
  );
}

/** Slab or 2-piece shaker doors and drawer fronts, and the shaker frame. */
function frontStyleSection(c) {
  const sh = c.shaker;
  const shaker = c.frontStyle === 'shaker';
  // Inch sizes in mm need two decimals (2 1/4" = 57.15).
  const shNum = (label, key, prop, min) =>
    lenField(label, key, sh[prop], (v) => editConstruction((c) => (c.shaker[prop] = Math.max(min, v))), { step: 0.01, mmFormat: (v) => String(Math.round(v * 100) / 100) });
  return h(
    'section',
    {},
    h('h3', {}, 'Front style'),
    h(
      'div',
      { class: 'fields' },
      selectField('Doors & drawer fronts', 'frontStyle', Object.entries(FRONT_STYLES), c.frontStyle, (v) => editConstruction((c) => (c.frontStyle = v))),
      shaker
        ? [
            shNum('Frame width', 'shFrame', 'frame', 10),
            shNum('Rabbet width', 'shRabbet', 'rabbet', 0.5),
            shNum('Panel clearance', 'shClear', 'clearance', 0),
            shNum('Min. opening', 'shMin', 'minOpening', 0),
          ]
        : null,
    ),
    shaker
      ? h(
          'p',
          { class: 'muted' },
          `A frame of the front material (${fmtLenU(sh.frame)} stiles and rails, opening cut through) with a ${fmtLenU(sh.rabbet)} rabbet around the opening on the back, ` +
            `as deep as the door panel material (Sheet materials) is thick, so the center panel's back sits flush. The panel is ${fmtLenU(sh.clearance)} short of the rabbet all round, ` +
            `its corners rounded to the CNC tool's radius like the rabbet's. Fronts whose opening would be under the min. opening (a short top drawer) stay slab. Shaker frames are not edge banded.`,
        )
      : null,
  );
}

/** The back joint and base cabinet stretchers. */
function caseSection(c) {
  return h(
    'section',
    {},
    h('h3', {}, 'Case'),
    h(
      'div',
      { class: 'fields' },
      selectField(
        'Back joint to bottom',
        'backJoint',
        [
          ['butt', 'Butt joint'],
          ['dado', 'Dado'],
        ],
        c.back.type,
        (v) => editConstruction((c) => (c.back = v === 'dado' ? { type: 'dado', depth: 6 } : { type: 'butt' })),
      ),
      c.back.type === 'dado' ? conNum(c, 'Dado depth', 'backDepth', (c) => c.back.depth, (c, v) => (c.back.depth = Math.max(0, v))) : null,
      conNum(c, 'Stretcher width', 'stretcher', (c) => c.stretcherWidth, (c, v) => (c.stretcherWidth = Math.max(30, v))),
    ),
    h('p', { class: 'muted' }, 'The back fits between the sides, flush with the rear. Base cabinets get front and rear stretchers instead of a top.'),
  );
}

/** What base and tall cabinets stand on. */
function baseSection(c) {
  const notes = {
    frame: 'A plinth frame under the case: front and rear rails with a cross member at every cabinet edge.',
    board: 'A single toe-kick board under the front of the case.',
    sides:
      'Base and tall sides run down to the floor, notched at the front base height high and base overhang deep, ' +
      'with a toe-kick board between them at the back of the notch. The case (bottom, shelves, doors, drawers) stays at the base height. ' +
      'The toe kick cover, cut from the front material like a filler, goes over the board and the notches and runs on under the cabinets beside.',
    none: 'No toe kick: base and tall cases stand on the floor and take the full cabinet height.',
  };
  return h(
    'section',
    {},
    h('h3', {}, 'Base (toe kick)'),
    h(
      'div',
      { class: 'fields' },
      selectField(
        'Base',
        'plinth',
        PLINTH_OPTIONS,
        c.plinth,
        (v) => editConstruction((c) => (c.plinth = v)),
        { wide: true },
      ),
      c.plinth === 'none'
        ? null
        : [
            conNum(c, 'Base height', 'toeH', (c) => c.toeKickHeight, (c, v) => (c.toeKickHeight = Math.max(0, v))),
            conNum(c, 'Base overhang', 'toeSet', (c) => c.toeKickSetback, (c, v) => (c.toeKickSetback = Math.max(0, v))),
            c.plinth === 'sides' ? checkboxField('Toe kick cover', 'toeCover', c.toeKickCover, (on) => editConstruction((c) => (c.toeKickCover = on))) : null,
          ],
    ),
    h('p', { class: 'muted' }, notes[c.plinth]),
  );
}

/** The 32mm line boring in the sides. */
function systemSection(c) {
  return h(
    'section',
    {},
    metricHeading('System holes'),
    h(
      'div',
      { class: 'fields' },
      conNum(c, 'Front setback', 'sysSetback', (c) => c.system.frontSetback, (c, v) => (c.system.frontSetback = v), { metric: true }),
      conNum(c, 'Spacing', 'sysSpacing', (c) => c.system.spacing, (c, v) => (c.system.spacing = Math.max(8, v)), { metric: true }),
      conNum(c, 'Grid origin', 'sysOrigin', (c) => c.system.origin, (c, v) => (c.system.origin = v), { metric: true }),
      conNum(c, 'Hole Ø', 'sysDia', (c) => c.system.diameter, (c, v) => (c.system.diameter = Math.max(1, v)), { metric: true }),
      checkboxField('Rear line', 'sysRear', c.system.rearLine, (on) => editConstruction((c) => (c.system.rearLine = on))),
    ),
    h('p', { class: 'muted' }, 'Hole lines run up both sides this far from the front (and the rear, when on), one spacing apart from the grid origin. Hinge plates and slides screw into them.'),
  );
}

/** Sizes new corner cabinets start from (each cabinet can change its own). */
function cornerSection(c) {
  const num = (label, key, min = 0) => conNum(c, label, `corner-${key}`, (c) => c.corner[key], (c, v) => (c.corner = { ...c.corner, [key]: Math.max(min, v) }));
  const base = newCorner('base', 0, c);
  const wall = newCorner('wall', 0, c);
  return [
    h(
      'section',
      {},
      h('h3', {}, 'Corner base'),
      h('div', { class: 'fields' }, num('Depth', 'baseDepth', 200), num('Door opening (own wall)', 'openingA', 100), num('Door opening (next wall)', 'openingB', 100)),
      h(
        'p',
        { class: 'muted' },
        `L-shaped, with a door on each leg: ${fmtLen(base.width)} along its wall × ${fmtLen(base.corner.return)} along the next, ${fmtLen(base.depth)} deep. ` +
          'The return door tucks behind the first door in the inside corner.',
      ),
    ),
    h(
      'section',
      {},
      h('h3', {}, 'Corner wall'),
      h('div', { class: 'fields' }, num('Along each wall', 'wallSize', 300)),
      h(
        'p',
        { class: 'muted' },
        `${fmtLen(wall.width)} × ${fmtLen(wall.corner.return)}, as deep as wall cabinets (${fmtLen(wall.depth)}), with one ` +
          `${fmtLenU(cornerDoors(wall, c).door)} door on the 45° diagonal (use a 45° hinge plate).`,
      ),
    ),
    h(
      'section',
      {},
      h('h3', {}, 'Back corner'),
      h('div', { class: 'fields' }, num('45° cut (each wall)', 'chamfer')),
      h('p', { class: 'muted' }, 'The back corner of corner cabinets is cut off at 45° by this much along each wall, so they clear an out-of-square corner; a narrow back panel closes it.'),
    ),
  ];
}

/** The continuous top over each run of base cabinets (3D view and Materials report). */
function countertopSection(c) {
  const ct = c.countertop;
  const set = (key, v) => editConstruction((c) => (c.countertop = { ...c.countertop, [key]: v }));
  const num = (label, key, min = 0) => conNum(c, label, `ct-${key}`, (c) => c.countertop[key], (c, v) => (c.countertop = { ...c.countertop, [key]: Math.max(min, v) }));
  return h(
    'section',
    {},
    h('h3', {}, 'Countertop'),
    h(
      'div',
      { class: 'fields' },
      checkboxField('On base runs', 'ct-enabled', ct.enabled, (on) => set('enabled', on)),
      ct.enabled
        ? [
            textField('Name', 'ct-name', ct.name, (v) => set('name', v.trim() || 'Countertop')),
            h(
              'label',
              { class: 'field' },
              h('span', {}, 'Colour (3D)'),
              h('input', { type: 'color', 'data-key': 'ct-color', value: ct.color, onchange: (e) => set('color', e.target.value) }),
            ),
            num('Thickness', 'thickness', 1),
            num('Front overhang', 'frontOverhang'),
            num('End overhang', 'endOverhang'),
            conCost(c, '$ / m', 'ct-cost', (c) => c.countertop.cost, (c, v) => (c.countertop = { ...c.countertop, cost: v })),
          ]
        : null,
    ),
    h(
      'p',
      { class: 'muted' },
      'One continuous top over each run of base cabinets and base fillers standing side by side (end panels included), from the wall to ' +
        'this far past the fronts, and past both ends of the run by the end overhang. It shows in the 3D view and its length in the Materials ' +
        'report; it is not a part, so it stays out of the cut list, drawings, nesting and CNC.',
    ),
  );
}

/** Paint products (coats, coverage, price) and which parts are painted. */
function paintSection(c) {
  const paint = c.paint;
  const edit = (fn) => editConstruction((c) => fn(c.paint));
  const cell = (i, key, attrs = {}) =>
    h(
      'td',
      { class: attrs.type === 'number' ? 'num' : null },
      h('input', {
        'aria-label': key,
        'data-key': `paint-${i}-${key}`,
        value: attrs.type === 'number' && key === 'cost' ? (paint.products[i][key] || 0).toFixed(2) : paint.products[i][key],
        ...attrs,
        onchange: (e) =>
          edit((pt) => {
            const v = attrs.type === 'number' ? parseFloat(e.target.value) : e.target.value.trim();
            if (attrs.type === 'number' ? Number.isFinite(v) && v >= 0 : v) pt.products[i][key] = v;
          }),
      }),
    );
  const faces = [
    [0, 'Not painted'],
    [1, 'One face'],
    [2, 'Both faces'],
  ];
  return [
    h(
      'section',
      {},
      h('h3', {}, 'Paint'),
      h('div', { class: 'fields' }, checkboxField('Paint the job', 'paint-enabled', paint.enabled, (on) => edit((pt) => (pt.enabled = on)))),
      paint.enabled
        ? [
            h(
              'table',
              { class: 'library paint-table' },
              h('thead', {}, h('tr', {}, ['Product', 'Coats', 'Coverage (ft²)', 'Unit', '$ / unit', ''].map((t) => h('th', {}, t)))),
              h(
                'tbody',
                {},
                paint.products.map((pr, i) =>
                  h(
                    'tr',
                    {},
                    cell(i, 'name'),
                    cell(i, 'coats', { type: 'number', min: 0, step: 1 }),
                    cell(i, 'coverage', { type: 'number', min: 1, step: 1 }),
                    cell(i, 'unit'),
                    cell(i, 'cost', { type: 'number', min: 0, step: 0.01 }),
                    h('td', {}, h('button', { class: 'danger', title: 'Delete product', 'aria-label': `Delete ${pr.name}`, onclick: () => edit((pt) => pt.products.splice(i, 1)) }, '×')),
                  ),
                ),
              ),
            ),
            h(
              'div',
              { class: 'add-row', style: { marginTop: '8px' } },
              h('button', { onclick: () => edit((pt) => pt.products.push({ name: 'Paint', coats: 1, coverage: 350, unit: 'gal', cost: 0 })) }, '+ Add product'),
            ),
            h(
              'p',
              { class: 'muted' },
              'Each product: painted area × coats ÷ coverage (ft² per unit), bought in whole units. ' +
                'Add a primer coat for new / raw material. The cost goes into the Materials report.',
            ),
          ]
        : null,
    ),
    paint.enabled
      ? h(
          'section',
          {},
          h('h3', {}, 'Painted parts'),
          h(
            'div',
            { class: 'fields' },
            Object.entries(PAINT_GROUPS).map(([id, label]) => {
              const g = paint.parts[id] ?? { faces: 0, edges: false };
              const set = (key, v) => edit((pt) => (pt.parts[id] = { ...g, [key]: v }));
              return h(
                'div',
                { class: 'field wide paint-part' },
                h('span', {}, label),
                h(
                  'div',
                  { class: 'paint-part-row' },
                  h('select', { 'data-key': `paint-${id}-faces`, 'aria-label': `${label} faces`, value: String(g.faces ?? 0), onchange: (e) => set('faces', Number(e.target.value)) }, faces.map(([v, l]) => h('option', { value: String(v) }, l))),
                  h('label', { class: 'paint-edges' }, h('input', { type: 'checkbox', 'data-key': `paint-${id}-edges`, checked: !!g.edges, onchange: (e) => set('edges', e.target.checked) }), 'Edges'),
                ),
              );
            }),
          ),
          h('p', { class: 'muted' }, 'A face is the part’s length × width; edges are all four, its perimeter × thickness. Standing panels are the panels from + Other.'),
        )
      : null,
  ];
}

/** Which library material the case, fronts and drawer boxes are cut from. */
function jobMaterialsSection(c) {
  const slotOptions = c.library.filter((m) => !m.edgeBand).map((m) => [m.id, materialLabel(m)]);
  return h(
    'section',
    {},
    h('h3', {}, 'Job materials'),
    h(
      'div',
      { class: 'fields' },
      SLOTS.map((slot) =>
        selectField(SLOT_LABELS[slot], `slot-${slot}`, slotOptions, c.materials[slot], (v) => editConstruction((c) => (c.materials[slot] = Number(v)))),
      ),
    ),
    h('p', { class: 'muted' }, 'The back is cut from the case material; drawer bottoms from the drawer box material; shaker center panels from the door panel material.'),
  );
}

function resetConstruction() {
  editConstruction((c) => {
    // Resets the standards but keeps the material library and choices,
    // and the Edge banding settings.
    const { library, materials, bands, partBands, edgeBanding, edgeBandTypes } = c;
    Object.assign(c, defaultConstruction(), { library, materials, bands, partBands, edgeBanding, edgeBandTypes });
    ensureBands(c);
  });
}

// ---- CNC page ------------------------------------------------------------------

/** The router's settings: machine, tool, feeds and speeds, heights, tabs, entry. */
function cncSections(c) {
  const cfg = c.cnc;
  // Lengths in the display units; counts, RPM and percentages as numbers.
  const num = (label, key, step = 1, min = 0) =>
    lenField(label, `cnc-${key}`, cfg[key], (v) => editConstruction((c) => (c.cnc[key] = Math.max(min, v))), { step });
  const plain = (label, key, step = 1, min = 0) =>
    numField(label, `cnc-${key}`, cfg[key], (v) => editConstruction((c) => (c.cnc[key] = Math.max(min, v))), { step });
  // Feeds are stored in mm/min and shown in mm/min or in/min.
  const rate = (label, key, min) =>
    numField(`${label} ${unitName()}/min`, `cnc-${key}`, rateValue(cfg[key]), (v) => editConstruction((c) => (c.cnc[key] = Math.max(min, rateToMm(v)))), {
      step: isImperial() ? 0.1 : 1,
      format: (v) => String(v),
    });
  const pick = (label, key, options) => selectField(label, `cnc-${key}`, options, cfg[key], (v) => editConstruction((c) => (c.cnc[key] = v)));
  const group = (title, fields, note) =>
    h('section', {}, h('h3', {}, title), h('div', { class: 'fields' }, fields), note ? h('p', { class: 'muted' }, note) : null);
  const d = cfg.toolDiameter;
  const lead = cfg.leadIn ? cfg.leadInRadius : 0;
  return [
    group(
      'Table & stock',
      [num('Table X', 'tableX'), num('Table Y', 'tableY'), num('Stock X', 'stockX'), num('Stock Y', 'stockY'), num('Margin', 'margin', 0.5), num('Part spacing', 'spacing', 0.5)],
      `Parts are nested on the stock. With the lead-in arc on, parts need ${fmtLenU(d + lead)} between them and ${fmtLenU(d / 2 + lead)} from the stock edge.`,
    ),
    group('Tool, feeds & speeds', [
      num('Tool Ø', 'toolDiameter', 0.1, 0.1),
      plain('Spindle RPM', 'rpm', 500),
      rate('Feed', 'feed', 1),
      rate('Plunge', 'plungeFeed', 1),
      rate('Rapid', 'rapidFeed', 1),
      num('Pass depth', 'passDepth', 0.5, 0.1),
      plain('Spindle delay s', 'spindleDelay', 1),
    ]),
    group(
      'Drilling',
      [
        num('Helix pitch', 'helixPitch', 0.5, 0.1),
        num('Peck depth', 'peck', 0.5, 0.5),
        pick('Peck retract', 'peckRetract', [
          ['full', 'Full (clears chips)'],
          ['chip', 'Chip break'],
        ]),
        cfg.peckRetract === 'chip' ? num('Chip break', 'chipBreak', 0.1, 0.1) : null,
      ],
      `Holes the tool’s size are plunged, or with Peck drilling on (CNC view, now ${cfg.peckDrill ? 'on' : 'off'}) drilled in pecks of this ` +
        'depth: a full retract lifts out of the hole after each peck and comes back down to just above its bottom, a chip break only backs off a little. ' +
        'Bigger holes are bored in a helix, this deep per turn.',
    ),
    group(
      'Dados',
      [plain('Stepover %', 'stepover', 5, 5)],
      'Dadoes and rabbets are cleared from the top, back and forth this share of the tool apart, ramping in like the cut-out. Through notches (the end panels’ toe kick) are part of the cut-out.',
    ),
    group('Heights', [num('Safe Z', 'safeZ', 1), num('Clearance Z', 'clearZ', 0.5), num('Cut through', 'cutThrough', 0.1)]),
    group(
      'Tabs',
      [
        pick('Shape', 'tabShape', [
          ['triangle', 'Triangle (ramped)'],
          ['square', 'Square'],
        ]),
        num('Length', 'tabLength', 0.5),
        num('Height', 'tabHeight', 0.5),
        num('Spacing', 'tabSpacing', 10, 50),
      ],
      'About one tab per spacing of perimeter, at least two per part. A triangle tab is the length at its base: the tool ramps up to the tab’s height and back down instead of plunging.',
    ),
    group(
      'Entry',
      [num('Ramp length', 'rampLength', 5, 1), num('Lead-in radius', 'leadInRadius', 0.5)],
      'The ramp brings the tool down along the outline instead of plunging; the lead-in arc only brings it onto the outline, this far outside it.',
    ),
  ];
}

// ---- units page ------------------------------------------------------------------

const PRECISION_LABELS = { 8: '1/8"', 16: '1/16"', 32: '1/32"', 0: 'Decimal (0.001")' };

/** Display units for the whole shop, and the US standard sizes preset. */
function unitsSections() {
  const { units, precision } = state.prefs;
  const example = [600, 19.05, 3657.6].map((mm) => `${fmtMm(mm)} mm → ${fmtLen(mm)}`).join(' · ');
  const useUs = async () => {
    if (!confirm('Use US standard sizes for new jobs? This changes the shop defaults for cabinet sizes, toe kick, appliance spaces, corner cabinets and the countertop. The open job and its cabinets stay as they are.')) return;
    try {
      await setShop(usStandardSizes(JSON.parse(JSON.stringify(state.shop))));
      setState({ unitsNote: 'New jobs now start with US standard sizes.' });
    } catch (e) {
      setState({ unitsNote: `Not saved: ${e.message}` });
    }
  };
  return [
    h(
      'section',
      {},
      h('h3', {}, 'Display units'),
      h(
        'div',
        { class: 'fields' },
        selectField(
          'Units',
          'prefUnits',
          [
            ['mm', 'Millimetres'],
            ['in', 'Inches'],
          ],
          units,
          (v) => setPrefs({ units: v }),
        ),
        units === 'in'
          ? selectField(
              'Inch precision',
              'prefPrecision',
              PRECISIONS.map((p) => [p, PRECISION_LABELS[p]]),
              precision,
              (v) => setPrefs({ precision: Number(v) }),
            )
          : null,
      ),
      h(
        'p',
        { class: 'muted' },
        'For every job in the shop. Sizes are still saved in millimetres, so switching changes only how they show and how typed numbers are read. ' +
          (units === 'in'
            ? `Over 36" shows as feet and inches. Type 23.5, 23 1/2, 4' 6" or 600mm. The 32mm system, hinges, drawers and slides, and material thicknesses stay in mm. ${example}`
            : 'In inches, fields take fractions (23 1/2), feet (4\' 6") and mm (600mm).'),
      ),
    ),
    h(
      'section',
      {},
      h('h3', {}, 'US standard sizes'),
      h(
        'p',
        { class: 'muted' },
        'Sets the shop defaults for new jobs: 24" wide cabinets, 34 1/2" base height with a 4" toe kick, 30" wall and 84" tall cabinets, 24" deep bases (12" walls) with the doors, ' +
          '24" dishwasher, 30" range, 36" fridge, 24" corner walls and a 1 1/2" countertop with a 1" overhang. Doors up to 24" stay single. The open job is not changed.',
      ),
      h('div', { class: 'add-row' }, h('button', { onclick: useUs }, 'Use US standard sizes for new jobs')),
      state.unitsNote ? h('p', {}, state.unitsNote) : null,
    ),
  ];
}

// The settings pages, in nav groups. Each page is a column of sections.
const PAGES = [
  {
    group: 'Shop',
    pages: [{ id: 'units', label: 'Units', intro: 'How lengths are shown and typed.', sections: unitsSections }],
  },
  {
    group: 'Cabinets',
    pages: [
      { id: 'cabinets', label: 'Sizes & fronts', intro: 'Sizes for new cabinets and how the fronts sit on the case.', sections: (c) => [cabinetSizesSection(c), spaceSizesSection(c), frontsSection(c), frontStyleSection(c)] },
      { id: 'case', label: 'Case & base', intro: 'How the case goes together and what it stands on.', sections: (c) => [caseSection(c), baseSection(c), endPanelSection(c)] },
      { id: 'corner', label: 'Corner cabinets', intro: 'Sizes new corner cabinets start from; each one can change its own.', sections: cornerSection },
      { id: 'countertop', label: 'Countertop', sections: (c) => [countertopSection(c)] },
      { id: 'system', label: '32mm system', sections: (c) => [systemSection(c)] },
    ],
  },
  {
    group: 'Hardware',
    pages: [
      { id: 'hinges', label: 'Hinges', sections: (c) => [hingeSection(c)] },
      { id: 'drawers', label: 'Drawers', intro: 'Slides, drawer boxes and the drawer front sizes in units.', sections: (c) => [slideSection(c), drawerBoxSection(c), drawerSizeSection(c)] },
    ],
  },
  {
    group: 'Materials',
    pages: [
      { id: 'materials', label: 'Sheet materials', wide: true, sections: (c) => [jobMaterialsSection(c), materialLibrary(c)] },
      { id: 'edgeBanding', label: 'Edge banding', wide: true, sections: (c) => [bandLibrary(c), bandTypeList(c), edgeBandingSection(c)] },
      { id: 'paint', label: 'Paint', intro: 'What the job takes to paint, for the Materials report.', sections: paintSection },
    ],
  },
  {
    group: 'Machining',
    pages: [
      {
        id: 'cnc',
        label: 'CNC router',
        intro:
          'The CNC router (GRBL): Z0 on top of the material, X0 Y0 at the front-left corner of the stock. ' +
          'Lengths and feeds follow the display units (Settings → Units), and so does the G-code: G21 (mm) or G20 (inches). ' +
          'Which operations run is chosen in the CNC view.',
        sections: cncSections,
      },
    ],
  },
];
const ALL_PAGES = PAGES.flatMap((g) => g.pages);
// Older names for the pages, still used to open the dialog.
const PAGE_ALIASES = { construction: 'cabinets' };

export function renderSettings(container) {
  if (!state.settings) {
    container.replaceChildren();
    return;
  }
  const c = state.project.construction;
  const id = PAGE_ALIASES[state.settings] ?? state.settings;
  const page = ALL_PAGES.find((p) => p.id === id) ?? ALL_PAGES[0];
  const link = (p) =>
    h('button', { class: p === page ? 'active' : null, 'aria-current': p === page ? 'page' : null, onclick: () => setState({ settings: p.id }) }, p.label);
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
          'aria-label': 'Settings',
          onclick: (e) => e.stopPropagation(),
        },
        h(
          'header',
          { class: 'modal-head' },
          h('h2', {}, 'Settings'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'icon-btn', 'aria-label': 'Close settings', onclick: close }, '✕'),
        ),
        h(
          'div',
          { class: 'settings-layout' },
          h(
            'nav',
            { class: 'settings-nav', 'aria-label': 'Settings sections' },
            PAGES.map((g) => h('div', { class: 'settings-nav-group' }, h('h4', {}, g.group), g.pages.map(link))),
            h(
              'div',
              { class: 'settings-nav-foot' },
              h('button', { onclick: resetConstruction, title: 'Back to the defaults, keeping the materials and edge banding' }, 'Reset to defaults'),
            ),
          ),
          h(
            'div',
            { class: 'settings-content', 'data-page': page.id },
            h(
              'div',
              { class: page.wide ? 'settings-page wide' : 'settings-page' },
              h('h2', {}, page.label),
              page.intro ? h('p', { class: 'muted' }, page.intro) : null,
              page.sections(c),
            ),
          ),
        ),
      ),
    ),
  );
}
