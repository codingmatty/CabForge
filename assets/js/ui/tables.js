// Parts table for the selected cabinet and the whole-job cut list.

import { cutListCsv } from '../engine/cutlist.js';
import { fmtMm, partStock } from '../engine/model.js';
import { PART_GROUPS, edgeCode, partGroup } from '../engine/part.js';
import { projectCutList } from '../engine/project.js';
import { download, h, mount } from './dom.js';
import { partKey, setState, setVisibility, state } from './store.js';
import { fmtArea, fmtLen, fmtRun, isImperial } from '../engine/units.js';

export function renderPartsTable(container) {
  const entry = state.built[state.selected];
  if (!entry) {
    mount(container, h('p', { class: 'muted', style: { padding: '8px' } }, 'No cabinet selected.'));
    return;
  }
  if (entry.error) {
    mount(container, h('div', { class: 'error' }, entry.error));
    return;
  }
  const c = state.project.construction;
  const cab = entry.cabinet;
  const spec = state.project.cabinets[state.selected];
  const rows = cab.parts.map((p, i) => {
    const key = partKey(spec, i);
    const groupHidden = state.hiddenGroups.has(partGroup(p.role));
    const hidden = groupHidden || state.hiddenParts.has(key);
    return h(
      'tr',
      {
        class: `clickable${state.selectedPart === i ? ' active' : ''}${hidden ? ' dim' : ''}`,
        onclick: () => setState({ selectedPart: i, view: 'part' }),
      },
      h(
        'td',
        { class: 'eye', onclick: (e) => e.stopPropagation() },
        h('input', {
          type: 'checkbox',
          'aria-label': `Show ${p.name} in 3D`,
          title: groupHidden ? `${PART_GROUPS[partGroup(p.role)]} are hidden (Visibility menu)` : 'Show in 3D',
          checked: !hidden,
          disabled: groupHidden,
          onchange: (e) =>
            setVisibility((s) => (e.target.checked ? s.hiddenParts.delete(key) : s.hiddenParts.add(key))),
        }),
      ),
      h('td', {}, p.name),
      [p.length, p.width].map((v) => h('td', { class: 'num' }, fmtLen(v))),
      h('td', { class: 'num' }, fmtMm(p.thickness)),
      h('td', {}, partStock(c, p)?.name ?? ''),
      h('td', {}, edgeCode(p.edges)),
      h('td', { class: 'num' }, p.ops.length),
    );
  });
  mount(
    container,
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { class: 'eye', title: 'Show in 3D' }, '👁'),
          h('th', {}, `Parts — ${cab.name}`),
          ['Length', 'Width', isImperial() ? 'Thick (mm)' : 'Thick'].map((t) => h('th', { class: 'num' }, t)),
          h('th', {}, 'Material'),
          h('th', {}, 'Edges'),
          h('th', { class: 'num' }, 'Ops'),
        ),
      ),
      h('tbody', {}, rows),
    ),
  );
}

export function renderCutList(container) {
  const list = projectCutList(state.project, state.built);
  const exportCsv = () => download(`${state.project.name} cut list.csv`, 'text/csv', cutListCsv(list));
  mount(
    container,
    h('div', { class: 'add-row' }, h('button', { class: 'primary', onclick: exportCsv }, 'Export CSV')),
    h(
      'div',
      { class: 'totals' },
      list.materials.map((m) =>
        h('div', {}, h('b', {}, fmtArea(m.areaM2)), `${m.material} ${fmtMm(m.thickness)} mm · ${m.parts} parts`),
      ),
    ),
    h('h3', {}, 'Edge banding for the job'),
    h(
      'div',
      { class: 'totals' },
      list.bands.map((b) =>
        h(
          'div',
          {},
          h('b', {}, fmtRun(b.m)),
          b.color ? h('i', { class: 'swatch band-swatch', style: { background: b.color } }) : null,
          `${b.name} ${fmtMm(b.thickness)} mm`,
          b.type ? h('span', { class: 'muted' }, ` · ${b.type}`) : null,
        ),
      ),
      list.bands.length > 1 ? h('div', { class: 'grand' }, h('b', {}, fmtRun(list.edgeBandM)), 'Total edge banding') : null,
      list.bands.length ? null : h('div', {}, h('b', {}, fmtRun(0, 0)), 'No banded edges'),
    ),
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { class: 'num' }, 'Qty'),
          h('th', {}, 'Part'),
          h('th', {}, 'Material'),
          ['Length', 'Width', 'Cut L', 'Cut W'].map((t) => h('th', { class: 'num' }, t)),
          h('th', {}, 'Edges'),
          h('th', {}, 'Edge band'),
          h('th', {}, 'Cabinets'),
        ),
      ),
      h(
        'tbody',
        {},
        list.rows.map((r) =>
          h(
            'tr',
            {},
            h('td', { class: 'num' }, r.qty),
            h('td', {}, r.name),
            h('td', {}, `${r.material} ${fmtMm(r.thickness)}`),
            [r.length, r.width, r.cutLength, r.cutWidth].map((v) => h('td', { class: 'num' }, fmtLen(v))),
            h('td', {}, r.edges),
            h('td', {}, r.band),
            h('td', {}, r.cabinets.join(', ')),
          ),
        ),
      ),
    ),
    list.solid.length ? solidTable(list) : null,
  );
}

/** Face frame stiles and rails: solid wood, cut to size (not nested). */
function solidTable(list) {
  return [
    h('h3', {}, 'Face frames (solid wood)'),
    h(
      'div',
      { class: 'totals' },
      list.woods.map((w) => h('div', {}, h('b', {}, `${w.boardFeet.toFixed(1)} bd ft`), `${w.name} · ${w.parts} parts, ${w.quarters}/4 with ${w.waste}% waste`)),
    ),
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { class: 'num' }, 'Qty'),
          h('th', {}, 'Part'),
          h('th', {}, 'Wood'),
          ['Length', 'Width', isImperial() ? 'Thick (mm)' : 'Thick'].map((t) => h('th', { class: 'num' }, t)),
          h('th', {}, 'Joinery'),
          h('th', {}, 'Cabinets'),
        ),
      ),
      h(
        'tbody',
        {},
        list.solid.map((r) =>
          h(
            'tr',
            {},
            h('td', { class: 'num' }, r.qty),
            h('td', {}, r.name),
            h('td', {}, r.wood),
            [r.length, r.width].map((v) => h('td', { class: 'num' }, fmtLen(v))),
            h('td', { class: 'num' }, fmtMm(r.thickness)),
            h('td', {}, r.joinery),
            h('td', {}, r.cabinets.join(', ')),
          ),
        ),
      ),
    ),
    h('p', { class: 'muted' }, 'Rail lengths include any tenons. Stiles run the full height of the frame; rails go between them.'),
  ];
}
