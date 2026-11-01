// CNC view: pick the parts to machine and the operations, nest them on the
// stock that fits the router table, and download a GRBL program per sheet
// (drilling and cut-out with one end mill). The machine settings are in
// Settings → CNC (part of the construction, so they become the shop's).

import { cncGroups, cncNesting, cncWarnings, gcode, onStock, sheetProgram, stockOutline, stockRect } from '../engine/cnc.js';
import { fmtMm, materialLabel } from '../engine/model.js';
import { nestGroup } from '../engine/nest.js';
import { checkboxField, download, h, mount, s, selectField } from './dom.js';
import { fmtLen, fmtLenU, fmtSize, rateValue, unitName } from '../engine/units.js';
import { setState, state, updateProject } from './store.js';

let worker = null;
let requestId = 0;
let result = { key: null, groups: [], error: '' };
let pendingKey = null;

function getWorker() {
  if (worker === null) {
    try {
      // Workers don't see the page's import map: pass this module's version along.
      const version = new URL(import.meta.url).search;
      worker = new Worker(new URL(`../engine/nest.worker.js${version}`, import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        if (e.data.id !== requestId) return; // superseded by a newer request
        result = { key: pendingKey, groups: e.data.result ?? [], error: e.data.error ?? '' };
        pendingKey = null;
        setState({});
      };
      worker.onerror = () => {
        worker = false;
      };
    } catch {
      worker = false;
    }
  }
  return worker || null;
}

const picked = () => new Set(state.project.cncParts ?? []);

/** Nests the picked parts when the job, the picks or the settings changed. */
function ensureNested() {
  const key = `${state.version}`;
  if (result.key === key || pendingKey === key) return;
  const c = state.project.construction;
  const groups = cncGroups(state.project, state.built, picked());
  const nesting = cncNesting(c.cnc);
  pendingKey = key;
  const w = getWorker();
  if (w) {
    w.postMessage({ id: ++requestId, groups, nesting });
  } else {
    result = { key, groups: groups.map((g) => nestGroup(g, { ...nesting, effort: 'quick' })), error: '' };
    pendingKey = null;
  }
}

const editCnc = (key, parse = (v) => Math.max(0, v)) => (v) => updateProject((p) => (p.construction.cnc[key] = parse(v)));
const setPicked = (fn) =>
  updateProject((p) => {
    const set = new Set(p.cncParts ?? []);
    fn(set);
    p.cncParts = [...set];
  });

// ---- part picker -------------------------------------------------------------

/** Every built part, by material: [{ material, rows: [{ key, part, cabinet }] }]. */
function partRows() {
  const c = state.project.construction;
  const byMat = new Map();
  state.project.cabinets.forEach((spec, i) => {
    const cab = state.built[i]?.cabinet;
    if (!cab) return;
    cab.parts.forEach((part, index) => {
      const m = c.library.find((x) => x.id === (part.materialId ?? c.materials[part.material]));
      if (!m) return;
      if (!byMat.has(m.id)) byMat.set(m.id, { material: m, rows: [] });
      byMat.get(m.id).rows.push({ key: `${spec.id}:${index}`, part, cabinet: cab.name });
    });
  });
  return [...byMat.values()].sort((a, b) => a.material.id - b.material.id);
}

function partPicker() {
  const sel = picked();
  const cfg = state.project.construction.cnc;
  const fits = (p) => {
    const room = [cfg.stockX - 2 * cfg.margin, cfg.stockY - 2 * cfg.margin];
    return (p.length <= room[0] && p.width <= room[1]) || (p.length <= room[1] && p.width <= room[0]);
  };
  const groups = partRows();
  if (!groups.length) return h('p', { class: 'muted' }, 'No parts yet.');
  return groups.map(({ material, rows }) => {
    const keys = rows.map((r) => r.key);
    const n = keys.filter((k) => sel.has(k)).length;
    return h(
      'details',
      { class: 'cnc-pick', open: n > 0 || groups.length === 1 },
      h(
        'summary',
        {},
        h('input', {
          type: 'checkbox',
          'aria-label': `All ${material.name} parts`,
          checked: n === keys.length,
          indeterminate: n > 0 && n < keys.length,
          onclick: (e) => e.stopPropagation(),
          onchange: (e) => setPicked((s) => keys.forEach((k) => (e.target.checked ? s.add(k) : s.delete(k)))),
        }),
        ` ${materialLabel(material)}`,
        h('span', { class: 'muted' }, ` · ${n} of ${keys.length} picked`),
      ),
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}), h('th', {}, 'Part'), h('th', {}, 'Cabinet'), h('th', { class: 'num' }, 'L × W'), h('th', { class: 'num' }, 'Holes'), h('th', {}, '')),
        ),
        h(
          'tbody',
          {},
          rows.map(({ key, part, cabinet }) => {
            const holes = part.ops.filter((op) => op.type === 'bore').length;
            const cuts = part.ops.filter((op) => op.type === 'pocket' || op.type === 'groove');
            const through = cuts.filter((op) => op.depth >= part.thickness - 0.05).length;
            const notes = [
              !fits(part) ? 'too big for the stock' : '',
              cuts.length > through ? 'dado' : '',
              through ? 'notch' : '',
              part.shaker ? 'shaker frame' : '',
            ].filter(Boolean);
            return h(
              'tr',
              { class: sel.has(key) ? '' : 'dim' },
              h(
                'td',
                {},
                h('input', {
                  type: 'checkbox',
                  'aria-label': `Send ${part.name} (${cabinet}) to the CNC`,
                  'data-key': `cnc-${key}`,
                  checked: sel.has(key),
                  onchange: (e) => setPicked((s) => (e.target.checked ? s.add(key) : s.delete(key))),
                }),
              ),
              h('td', {}, part.name),
              h('td', {}, cabinet),
              h('td', { class: 'num' }, `${fmtSize(part.length, part.width)}`),
              h('td', { class: 'num' }, holes || ''),
              h('td', { class: notes.length && !fits(part) ? 'err' : 'muted-cell' }, notes.join(' · ')),
            );
          }),
        ),
      ),
    );
  });
}

// ---- settings ------------------------------------------------------------------

function operations(cfg) {
  return h(
    'div',
    { class: 'nest-toolbar' },
    checkboxField('Drilling', 'cncDrill', cfg.drill, editCnc('drill', Boolean)),
    checkboxField('Peck drilling', 'cncPeck', cfg.peckDrill, (on) =>
      updateProject((p) => {
        p.construction.cnc.peckDrill = Boolean(on);
        // Older settings saved 0 for "no pecking".
        if (on && !(p.construction.cnc.peck > 0)) p.construction.cnc.peck = 3;
      }),
    ),
    checkboxField('Dados', 'cncPockets', cfg.pockets, editCnc('pockets', Boolean)),
    checkboxField('Cut out', 'cncProfile', cfg.profile, editCnc('profile', Boolean)),
    checkboxField('Ramp entry', 'cncRamp', cfg.ramp, editCnc('ramp', Boolean)),
    checkboxField('Lead-in arc', 'cncLead', cfg.leadIn, editCnc('leadIn', Boolean)),
    checkboxField('Tabs', 'cncTabs', cfg.tabs, editCnc('tabs', Boolean)),
    selectField(
      'Cut direction',
      'cncDir',
      [
        ['climb', 'Climb'],
        ['conventional', 'Conventional'],
      ],
      cfg.direction,
      editCnc('direction', String),
    ),
    h('button', { onclick: () => setState({ settings: 'cnc' }) }, 'CNC settings…'),
  );
}

// ---- sheets --------------------------------------------------------------------

/** A sheet as seen from above the table: Y up, the parts, holes and toolpath. */
function sheetPreview(cfg, sheet, program) {
  const [X, Y] = [cfg.stockX, cfg.stockY];
  const fy = (y) => Y - y;
  // Feed moves as one path, rapids as another (arcs drawn as arcs).
  let feeds = '';
  let rapids = '';
  let at = { x: 0, y: 0, z: cfg.safeZ };
  for (const m of program.moves) {
    if (m.g === undefined) continue;
    if (m.x === at.x && m.y === at.y) {
      at = m;
      continue;
    }
    const start = `M${at.x} ${fy(at.y)}`;
    if (m.g === 0) rapids += `${start}L${m.x} ${fy(m.y)}`;
    else if (m.g === 1) feeds += `${start}L${m.x} ${fy(m.y)}`;
    else feeds += `${start}A${Math.hypot(m.i, m.j)} ${Math.hypot(m.i, m.j)} 0 0 ${m.g === 2 ? 1 : 0} ${m.x} ${fy(m.y)}`;
    at = m;
  }
  const font = Math.max(X, Y) * 0.025;
  return s(
    'svg',
    { viewBox: `-20 -20 ${X + 40} ${Y + 40}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Sheet toolpath' },
    s('rect', { class: 'nest-sheet', x: 0, y: 0, width: X, height: Y }),
    sheet.parts.map((p) =>
      s(
        'g',
        {},
        s('title', {}, `#${p.number} ${p.name} — ${p.cabinet}\n${fmtSize(p.length, p.width)}${p.rotated ? ' (rotated)' : ''}`),
        s('polygon', { class: 'cnc-part', points: stockOutline(p).map(([x, y]) => `${x},${fy(y)}`).join(' ') }),
        (p.pockets ?? []).map((pk) => {
          const r = stockRect(p, pk);
          return s('rect', { class: 'cnc-pocket', x: r.x0, y: fy(r.y1), width: r.x1 - r.x0, height: r.y1 - r.y0 });
        }),
        p.holes.map((hl) => {
          const [hx, hy] = onStock(p, hl.x, hl.y);
          return s('circle', { class: `bore-${hl.purpose}`, cx: hx, cy: fy(hy), r: hl.diameter / 2 });
        }),
        s('text', { class: 'nest-label', x: p.x + p.sizeX / 2, y: fy(p.y + p.sizeY / 2) + font * 0.35, 'font-size': Math.min(font, p.sizeY * 0.5), 'text-anchor': 'middle', 'font-weight': 700 }, p.number),
      ),
    ),
    s('path', { class: 'cnc-rapid', d: rapids }),
    s('path', { class: 'cnc-feed', d: feeds }),
    s('circle', { class: 'cnc-origin', cx: 0, cy: Y, r: font * 0.3 }),
    s('text', { class: 'dw-muted', x: font * 0.4, y: Y - font * 0.4, 'font-size': font * 0.7 }, 'X0 Y0'),
  );
}

const fileName = (g, i) => `${state.project.name || 'Job'} - ${g.material.name} ${fmtMm(g.material.thickness)}mm - sheet ${i + 1}.nc`.replace(/[\\/:*?"<>|]/g, '-');

function sheetCard(cfg, g, sheet, i) {
  const program = sheetProgram(sheet, cfg, g.material.thickness);
  const holes = sheet.parts.reduce((n, p) => n + p.holes.length, 0);
  const title = [
    `CabForge - ${state.project.name || 'Job'}`,
    `${g.material.name} ${fmtMm(g.material.thickness)} mm - sheet ${i + 1} of ${g.sheets.length}`,
    ...sheet.parts.map((p) => `#${p.number} ${p.name} - ${p.cabinet} - ${fmtSize(p.length, p.width).replace(' × ', ' x ')}${p.rotated ? ' rotated' : ''}`),
  ];
  const save = () => download(fileName(g, i), 'text/plain', gcode(program, cfg, title));
  return {
    save,
    element: h(
      'figure',
      { class: 'sheet' },
      sheetPreview(cfg, sheet, program),
      h(
        'figcaption',
        {},
        h('strong', {}, `Sheet ${i + 1} of ${g.sheets.length}`),
        ` · ${sheet.parts.length} parts · ${holes} holes · about ${Math.ceil(program.minutes)} min`,
        h('button', { class: 'primary cnc-save', onclick: save }, 'Download G-code'),
      ),
      program.warnings.map((w) => h('div', { class: 'error' }, w)),
      h(
        'details',
        { class: 'sheet-list' },
        h('summary', {}, 'Parts'),
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', { class: 'num' }, '#'), h('th', {}, 'Part'), h('th', {}, 'Cabinet'), h('th', { class: 'num' }, 'L × W'), h('th', { class: 'num' }, 'X, Y'), h('th', {}, ''))),
          h(
            'tbody',
            {},
            sheet.parts.map((p) =>
              h(
                'tr',
                {},
                h('td', { class: 'num' }, p.number),
                h('td', {}, p.name),
                h('td', {}, p.cabinet),
                h('td', { class: 'num' }, `${fmtSize(p.length, p.width)}`),
                h('td', { class: 'num' }, `${fmtLen(p.x)}, ${fmtLen(p.y)}`),
                h('td', {}, p.rotated ? '↻ rotated' : ''),
              ),
            ),
          ),
        ),
      ),
    ),
  };
}

export function renderCnc(container) {
  ensureNested();
  const cfg = state.project.construction.cnc;
  const busy = pendingKey !== null;
  const count = picked().size;
  const cards = busy ? [] : result.groups.map((g) => ({ g, cards: g.sheets.map((sheet, i) => sheetCard(cfg, g, sheet, i)) }));
  const all = cards.flatMap((x) => x.cards);
  const saveAll = () => all.forEach((card, k) => setTimeout(card.save, k * 400));

  mount(
    container,
    h('h2', { class: 'supply-title' }, 'CNC'),
    h(
      'p',
      { class: 'muted' },
      `Table ${fmtSize(cfg.tableX, cfg.tableY)}${unitName() === 'mm' ? ' mm' : ''} · stock ${fmtSize(cfg.stockX, cfg.stockY)}${unitName() === 'mm' ? ' mm' : ''} · ` +
        `${fmtLenU(cfg.toolDiameter)} end mill at ${Math.round(cfg.rpm)} rpm, ${rateValue(cfg.feed)} ${unitName()}/min · GRBL (${unitName() === 'in' ? 'G20, inches' : 'G21, mm'}), Z0 on top of the material.`,
    ),
    cncWarnings(cfg).map((w) => h('div', { class: 'error' }, w)),
    h('h3', {}, 'Parts to machine'),
    h(
      'div',
      { class: 'add-row' },
      h('button', { onclick: () => setPicked((s) => partRows().forEach((g) => g.rows.forEach((r) => s.add(r.key)))) }, 'Pick all'),
      h('button', { onclick: () => setPicked((s) => s.clear()), disabled: !count }, 'Clear'),
    ),
    partPicker(),
    h('h3', {}, 'Operations'),
    operations(cfg),
    h(
      'div',
      { class: 'nest-toolbar', style: { marginTop: '14px' } },
      h('h3', { style: { margin: 0 } }, 'Sheets'),
      h('div', { class: 'spacer' }),
      h(
        'span',
        { class: busy ? 'nest-status busy' : 'nest-status', role: 'status' },
        busy ? 'Nesting…' : count ? `${all.length} sheet${all.length === 1 ? '' : 's'}` : 'Pick parts to machine',
      ),
      h('button', { class: 'primary', onclick: saveAll, disabled: busy || !all.length }, 'Download all'),
    ),
    result.error ? h('div', { class: 'error' }, `Nesting failed: ${result.error}`) : null,
    cards.map(({ g, cards }) =>
      h(
        'section',
        { class: 'nest-group' },
        h(
          'h2',
          {},
          materialLabel(g.material),
          h('span', { class: 'muted' }, ` · ${g.sheets.length} sheet${g.sheets.length === 1 ? '' : 's'} · ${g.partCount} parts${g.material.grain ? ' · grain along X' : ''}`),
        ),
        g.unplaced.length
          ? h(
              'div',
              { class: 'error' },
              `${g.unplaced.length} part${g.unplaced.length > 1 ? 's don’t' : ' doesn’t'} fit on the stock: `,
              g.unplaced.map((p) => `${p.name} (${p.cabinet}) ${fmtSize(p.length, p.width)}`).join('; '),
            )
          : null,
        h('div', { class: 'sheet-grid' }, cards.map((c) => c.element)),
      ),
    ),
  );
}
