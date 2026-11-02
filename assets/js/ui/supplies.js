// Materials view: everything the job needs to buy — sheets (from the
// nesting plan), edge banding, countertops, paint and hardware.

import { countertops } from '../engine/countertop.js';
import { fmtMm, fmtMoney } from '../engine/model.js';
import { FT2_PER_M2 } from '../engine/paint.js';
import { supplies, suppliesCsv } from '../engine/supplies.js';
import { download, h, mount } from './dom.js';
import { sheetsNeeded } from './nesting.js';
import { state } from './store.js';
import { fmtArea, fmtLenU, fmtRun, fmtSize } from '../engine/units.js';

const table = (head, rows, numeric) =>
  h(
    'table',
    { class: 'supply-table' },
    h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { class: numeric.includes(i) ? 'num' : null }, t)))),
    h('tbody', {}, rows),
  );

function printSupplies() {
  document.body.classList.add('print-supplies');
  window.addEventListener('afterprint', () => document.body.classList.remove('print-supplies'), { once: true });
  window.print();
}

export function renderSupplies(container) {
  const cabinets = state.built.filter((b) => b.cabinet).map((b) => b.cabinet);
  const sheets = sheetsNeeded();
  const s = supplies(cabinets, state.project.construction, sheets, countertops(state.project, state.built));
  const failed = state.built.filter((b) => b.error).length;
  const totalSheets = sheets ? s.sheets.reduce((n, m) => n + (m.sheets ?? 0), 0) : null;
  const pairs = s.hardware.filter((r) => r.unit === 'pairs').reduce((n, r) => n + r.qty, 0);
  const hinges = s.hardware.filter((r) => r.item === 'Hinge').reduce((n, r) => n + r.qty, 0);
  // Unpriced materials show a dash rather than $0.00.
  const money = (unit, cost) => (!unit ? '—' : cost == null ? '…' : fmtMoney(cost));
  const paint = s.paint;
  const painting = paint.areaM2 > 0;
  const gallons = paint.products.reduce((n, pr) => n + pr.buy, 0);
  const unpriced = [...s.sheets, ...s.woods, ...s.bands, ...s.tops, ...(painting ? paint.products : []), ...s.hardware.filter((r) => r.item !== 'Shelf pins')].filter((r) => !r.unitCost).length;
  const exportCsv = () => download(`${state.project.name || 'Job'} materials.csv`, 'text/csv', suppliesCsv(s));

  mount(
    container,
    h(
      'div',
      { class: 'add-row supply-actions' },
      h('button', { class: 'primary', onclick: exportCsv, disabled: !sheets }, 'Export CSV'),
      h('button', { onclick: printSupplies, disabled: !sheets }, 'Print'),
      sheets ? null : h('span', { class: 'nest-status busy' }, 'Working out sheet counts…'),
    ),
    h('h2', { class: 'supply-title' }, `Materials for ${state.project.name || 'this job'}`),
    failed ? h('div', { class: 'error' }, `${failed} cabinet${failed === 1 ? ' has' : 's have'} errors and ${failed === 1 ? 'is' : 'are'} not counted.`) : null,
    h(
      'div',
      { class: 'totals' },
      h('div', {}, h('b', {}, totalSheets ?? '…'), 'Sheets'),
      h('div', {}, h('b', {}, fmtRun(s.edgeBandM)), 'Edge banding'),
      s.tops.length ? h('div', {}, h('b', {}, fmtRun(s.topM, 2)), 'Countertop') : null,
      painting ? h('div', {}, h('b', {}, `${gallons} ${paint.products[0]?.unit ?? 'gal'}`), 'Paint') : null,
      h('div', {}, h('b', {}, hinges), 'Hinges'),
      h('div', {}, h('b', {}, pairs), 'Pairs of slides'),
      h('div', { class: 'grand' }, h('b', {}, s.materialCost == null ? '…' : fmtMoney(s.materialCost)), 'Materials'),
      h('div', {}, h('b', {}, fmtMoney(s.hardwareCost)), 'Hardware'),
      h('div', { class: 'grand' }, h('b', {}, s.totalCost == null ? '…' : fmtMoney(s.totalCost)), 'Total cost'),
    ),
    unpriced
      ? h(
          'p',
          { class: 'muted' },
          `${unpriced} item${unpriced === 1 ? ' has' : 's have'} no price and ${unpriced === 1 ? 'is' : 'are'} left out of the cost. ` +
            'Set prices in Settings: Sheet materials, Solid wood, Edge banding, Paint, Countertop, Hinges and Drawers.',
        )
      : null,
    h('h3', {}, 'Sheet goods'),
    s.sheets.length
      ? table(
          ['Material', 'Thickness', 'Sheet size', 'Parts', 'Part area', 'Sheets', '$ / sheet', 'Cost'],
          s.sheets.map((m) =>
            h(
              'tr',
              {},
              h('td', {}, m.material),
              h('td', { class: 'num' }, `${fmtMm(m.thickness)} mm`),
              h('td', { class: 'num' }, fmtSize(m.sheetLength, m.sheetWidth)),
              h('td', { class: 'num' }, m.parts),
              h('td', { class: 'num' }, fmtArea(m.areaM2)),
              h('td', { class: 'num qty' }, m.sheets ?? '…'),
              h('td', { class: 'num' }, m.unitCost ? fmtMoney(m.unitCost) : '—'),
              h('td', { class: 'num qty' }, money(m.unitCost, m.cost)),
            ),
          ),
          [1, 2, 3, 4, 5, 6, 7],
        )
      : h('p', { class: 'muted' }, 'No parts yet.'),
    s.woods.length ? h('h3', {}, 'Solid wood (face frames)') : null,
    s.woods.length
      ? table(
          ['Wood', 'Rough', 'Parts', 'Board feet', '$ / bd ft', 'Cost'],
          s.woods.map((w) =>
            h(
              'tr',
              {},
              h('td', {}, w.name),
              h('td', { class: 'num' }, `${w.quarters}/4`),
              h('td', { class: 'num' }, w.parts),
              h('td', { class: 'num qty', title: `Including ${w.waste}% waste` }, w.boardFeet.toFixed(1)),
              h('td', { class: 'num' }, w.unitCost ? fmtMoney(w.unitCost) : '—'),
              h('td', { class: 'num qty' }, w.unitCost ? fmtMoney(w.cost) : '—'),
            ),
          ),
          [1, 2, 3, 4, 5],
        )
      : null,
    h('h3', {}, 'Edge banding'),
    s.bands.length
      ? table(
          ['Band', 'Type', 'Thickness', 'Length', '$ / m', 'Cost'],
          s.bands.map((b) =>
            h(
              'tr',
              {},
              h('td', {}, b.color ? h('i', { class: 'swatch band-swatch', style: { background: b.color } }) : null, b.name),
              h('td', {}, b.type),
              h('td', { class: 'num' }, `${fmtMm(b.thickness)} mm`),
              h('td', { class: 'num qty' }, fmtRun(b.m)),
              h('td', { class: 'num' }, b.unitCost ? fmtMoney(b.unitCost) : '—'),
              h('td', { class: 'num qty' }, money(b.unitCost, b.cost)),
            ),
          ),
          [2, 3, 4, 5],
        )
      : h('p', { class: 'muted' }, 'No banded edges.'),
    s.tops.length ? h('h3', {}, 'Countertops') : null,
    s.tops.length
      ? table(
          ['Countertop', 'Run', 'Length', 'Depth', 'Thickness', '$ / m', 'Cost'],
          s.tops.map((t) =>
            h(
              'tr',
              {},
              h('td', {}, t.name),
              h('td', { class: 'muted-cell' }, t.run),
              h('td', { class: 'num qty' }, fmtLenU(t.length)),
              h('td', { class: 'num' }, fmtLenU(t.depth)),
              h('td', { class: 'num' }, fmtLenU(t.thickness)),
              h('td', { class: 'num' }, t.unitCost ? fmtMoney(t.unitCost) : '—'),
              h('td', { class: 'num qty' }, money(t.unitCost, t.cost)),
            ),
          ),
          [2, 3, 4, 5, 6],
        )
      : null,
    painting ? h('h3', {}, 'Paint') : null,
    painting
      ? [
          table(
            ['Painted', 'Parts', 'Area', ''],
            [
              ...paint.groups.map((g) =>
                h(
                  'tr',
                  {},
                  h('td', {}, g.label),
                  h('td', { class: 'num' }, g.parts),
                  h('td', { class: 'num' }, `${g.areaM2.toFixed(2)} m²`),
                  h('td', { class: 'num muted-cell' }, `${(g.areaM2 * FT2_PER_M2).toFixed(0)} ft²`),
                ),
              ),
              h(
                'tr',
                { class: 'total-row' },
                h('td', {}, 'Total'),
                h('td', { class: 'num' }, paint.groups.reduce((n, g) => n + g.parts, 0)),
                h('td', { class: 'num qty' }, `${paint.areaM2.toFixed(2)} m²`),
                h('td', { class: 'num qty' }, `${paint.areaFt2.toFixed(0)} ft²`),
              ),
            ],
            [1, 2, 3],
          ),
          table(
            ['Product', 'Coats', 'Coverage', 'Needed', 'Buy', '$ / unit', 'Used', 'Cost'],
            paint.products.map((pr) =>
              h(
                'tr',
                {},
                h('td', {}, pr.name),
                h('td', { class: 'num' }, pr.coats),
                h('td', { class: 'num' }, `${pr.coverage} ft² / ${pr.unit}`),
                h('td', { class: 'num' }, `${pr.qty.toFixed(2)} ${pr.unit}`),
                h('td', { class: 'num qty' }, `${pr.buy} ${pr.unit}`),
                h('td', { class: 'num' }, pr.unitCost ? fmtMoney(pr.unitCost) : '—'),
                h('td', { class: 'num muted-cell', title: 'The paint the coats use, at the unit price' }, pr.unitCost ? fmtMoney(pr.actualCost) : '—'),
                h('td', { class: 'num qty' }, pr.unitCost ? fmtMoney(pr.cost) : '—'),
              ),
            ),
            [1, 2, 3, 4, 5, 6, 7],
          ),
        ]
      : null,
    h('h3', {}, 'Hardware'),
    s.hardware.length
      ? table(
          ['Item', 'Specification', 'Quantity', '$ / unit', 'Cost', 'Cabinets'],
          s.hardware.map((r) =>
            h(
              'tr',
              {},
              h('td', {}, r.item),
              h('td', {}, r.spec),
              h('td', { class: 'num qty' }, `${r.qty} ${r.unit}`),
              h('td', { class: 'num' }, r.unitCost ? fmtMoney(r.unitCost) : '—'),
              h('td', { class: 'num qty' }, money(r.unitCost, r.cost)),
              h('td', { class: 'muted-cell' }, r.cabinets.join(', ')),
            ),
          ),
          [2, 3, 4],
        )
      : h('p', { class: 'muted' }, 'No hardware.'),
    h(
      'p',
      { class: 'muted supply-note' },
      'Sheet counts follow the Nesting plan (kerf, trim and mode from its settings). Edge banding is the exact banded edge length, with no trimming allowance. ' +
        'Solid wood is board feet of rough stock for the face frames, with the waste allowance (Settings → Solid wood). ' +
        'Countertops are one continuous length per run of base cabinets, end overhangs included, with no joints or cut-outs. ' +
        'Paint is the painted area (the faces and edges set in Settings: Paint) × coats ÷ coverage, bought in whole containers. ' +
        'Material cost is whole sheets × price per sheet plus banding length × price per metre, countertop length × price per metre and paint containers × price; hardware is quantity × unit price.',
    ),
  );
}
