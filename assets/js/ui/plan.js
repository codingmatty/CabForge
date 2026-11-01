// Plan view: the room from above (walls, islands, cabinet footprints and
// countertops) and the room editor beside it: wall lengths and corners,
// islands and where they stand.

import { footprint } from '../engine/build.js';
import { countertops } from '../engine/countertop.js';
import { fmtLen } from '../engine/units.js';
import { cabinetPlacement, relayout } from '../engine/project.js';
import { DEFAULT_WALL_COLOR, ISLAND_TYPES, TURNS, addIsland, addWall, locations, removeLocation } from '../engine/room.js';
import { h, lenField, mount, s, selectField, textField } from './dom.js';
import { setState, state, toggleSelect, updateProject } from './store.js';

const WALL = 100; // drawn wall thickness
const LINE_UP = { auto: 'Auto (the corner, when one ends the wall)', start: 'Wall start (left)', end: 'Wall end (right)' };
const RUN_CLASS = { base: 'pl-base', tall: 'pl-tall', wall: 'pl-upper', filler: 'pl-base' };

function editRoom(fn) {
  updateProject((p) => {
    fn(p.room, p);
    relayout(p);
  });
}

/** One wall's or island's settings. */
function wallEditor(wall, i, count) {
  const set = (key, v) => editRoom((room) => (room.walls.find((w) => w.id === wall.id)[key] = v));
  return h(
    'section',
    { class: 'room-item' },
    h(
      'div',
      { class: 'fields' },
      textField('Name', `wall-${wall.id}-name`, wall.name, (v) => set('name', v.trim() || wall.name), { wide: true }),
      lenField('Length', `wall-${wall.id}-length`, wall.length, (v) => set('length', Math.max(100, v))),
      i > 0 ? selectField('Meets the wall before', `wall-${wall.id}-turn`, Object.entries(TURNS), wall.turn, (v) => set('turn', v)) : null,
      selectField('Line up from', `wall-${wall.id}-from`, Object.entries(LINE_UP), wall.from ?? 'auto', (v) => set('from', v), { wide: true }),
    ),
    count > 1
      ? h('button', { class: 'danger', onclick: () => editRoom((room, p) => removeLocation(p, 'wall', wall.id)) }, 'Remove wall')
      : null,
  );
}

function islandEditor(island) {
  const set = (key, v) => editRoom((room) => (room.islands.find((x) => x.id === island.id)[key] = v));
  return h(
    'section',
    { class: 'room-item' },
    h(
      'div',
      { class: 'fields' },
      textField('Name', `isl-${island.id}-name`, island.name, (v) => set('name', v.trim() || island.name), { wide: true }),
      selectField('Type', `isl-${island.id}-type`, Object.entries(ISLAND_TYPES), island.type, (v) => set('type', v)),
      selectField(
        'Facing',
        `isl-${island.id}-rot`,
        [
          [0, 'Front (0°)'],
          [90, '90°'],
          [180, 'Back (180°)'],
          [270, '270°'],
        ],
        island.rotation,
        (v) => set('rotation', Number(v)),
      ),
      lenField('X (left)', `isl-${island.id}-x`, island.x, (v) => set('x', v)),
      lenField('Y (top, from wall 1)', `isl-${island.id}-z`, island.z, (v) => set('z', v)),
      lenField(island.type === 'double' ? 'Seating overhang (back row side)' : 'Seating overhang (back)', `isl-${island.id}-oh`, island.overhang, (v) => set('overhang', Math.max(0, v)), { wide: true }),
      lenField('End overhang (both ends)', `isl-${island.id}-ends`, island.ends ?? 0, (v) => set('ends', Math.max(0, v)), { wide: true }),
    ),
    h('button', { class: 'danger', onclick: () => editRoom((room, p) => removeLocation(p, 'island', island.id)) }, 'Remove island'),
  );
}

function roomEditor(p) {
  const addTo = (fn) => {
    let id;
    editRoom((room, p) => (id = fn(p)));
    setState({ at: id });
  };
  return h(
    'div',
    { class: 'room-editor' },
    h('h3', {}, 'Walls'),
    h(
      'p',
      { class: 'muted hint-small' },
      'Wall 1 runs left to right; each next wall turns 90° at its end. An inside corner is the usual kitchen corner.',
    ),
    p.room.walls.map((w, i) => wallEditor(w, i, p.room.walls.length)),
    h('div', { class: 'add-row' }, h('button', { onclick: () => addTo(addWall) }, '+ Wall')),
    h(
      'div',
      { class: 'fields' },
      lenField('Ceiling height (3D walls)', 'room-height', p.room.height ?? 2400, (v) => editRoom((room) => (room.height = Math.max(500, v)))),
      h(
        'label',
        { class: 'field' },
        h('span', {}, 'Wall colour (3D)'),
        h('input', { type: 'color', 'data-key': 'room-wall-color', value: p.room.wallColor ?? DEFAULT_WALL_COLOR, onchange: (e) => editRoom((room) => (room.wallColor = e.target.value)) }),
      ),
    ),
    h('h3', {}, 'Islands'),
    p.room.islands.length ? p.room.islands.map(islandEditor) : h('p', { class: 'muted hint-small' }, 'No islands.'),
    h('div', { class: 'add-row' }, h('button', { onclick: () => addTo(addIsland) }, '+ Island')),
  );
}

export function renderPlan(container) {
  const { project: p, built, selected } = state;
  const locs = locations(p);
  // Text scales with the room: from the walls' and islands' extent.
  const ends = locs.flatMap((l) => [l.origin, [l.origin[0] + l.u[0] * l.length, l.origin[1] + l.u[1] * l.length]]);
  const span = Math.max(1000, ...[0, 1].map((k) => Math.max(...ends.map((q) => q[k])) - Math.min(...ends.map((q) => q[k]))));
  const font = span * 0.022;
  const pts = [];
  const poly = (points, attrs) => {
    pts.push(...points);
    return s('polygon', { points: points.map(([x, z]) => `${x},${z}`).join(' '), ...attrs });
  };
  const toPlan = (map, [x, z]) => {
    const [wx, , wz] = map.point([x, 0, z]);
    return [wx, wz];
  };

  // Walls, drawn behind their line.
  const walls = locs
    .filter((l) => l.kind === 'wall')
    .map((l) => {
      const a = l.origin;
      const b = [a[0] + l.u[0] * l.length, a[1] + l.u[1] * l.length];
      const back = (q, k = WALL) => [q[0] - l.n[0] * k, q[1] - l.n[1] * k];
      const mid = [(a[0] + b[0]) / 2 - l.n[0] * WALL * 2.2, (a[1] + b[1]) / 2 - l.n[1] * WALL * 2.2];
      return s(
        'g',
        { class: 'cab-hit', onclick: () => setState({ at: l.id }) },
        poly([a, b, back(b), back(a)], { class: l.id === state.at ? 'pl-wall active' : 'pl-wall' }),
        s('text', { class: 'dw-text pl-label', x: mid[0], y: mid[1], 'font-size': font, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, `${l.name} · ${fmtLen(l.length)}`),
      );
    });

  const tops = countertops(p, built).map((t) =>
    poly(
      [
        [t.x0, t.z0],
        [t.x1, t.z0],
        [t.x1, t.z0 + t.depth],
        [t.x0, t.z0 + t.depth],
      ].map((q) => toPlan(t.map, q)),
      { class: 'pl-top' },
    ),
  );

  // Cabinets: upper cabinets last, dashed over the base run.
  const order = p.cabinets.map((spec, i) => [spec, i]).sort(([a], [b]) => (a.kind === 'wall') - (b.kind === 'wall'));
  const cabinets = order.map(([spec, i]) => {
    const map = cabinetPlacement(p, spec);
    const outline = footprint(spec, p.construction).map((q) => toPlan(map, q));
    const run = spec.kind === 'filler' || spec.kind === 'space' ? spec.run : spec.kind;
    const cls = [spec.kind === 'space' ? 'pl-space' : RUN_CLASS[run] ?? 'pl-base', i === selected ? 'selected' : '', built[i]?.error ? 'err' : ''].join(' ');
    // Labels: base cabinets in the middle, upper ones nearer the wall.
    const centre = outline.reduce((m, q) => [m[0] + q[0] / outline.length, m[1] + q[1] / outline.length], [0, 0]);
    const shift = spec.kind === 'wall' ? map.dir([0, 0, -spec.depth / 4]) : [0, 0, 0];
    const c = [centre[0] + shift[0], centre[1] + shift[2]];
    return s(
      'g',
      { class: 'cab-hit', onclick: () => toggleSelect(i) },
      poly(outline, { class: cls }),
      spec.kind === 'filler' ? null : s('text', { class: 'dw-text pl-cab', x: c[0], y: c[1], 'font-size': font * 0.75, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, spec.name),
    );
  });

  const islandLabels = locs
    .filter((l) => l.kind === 'island' && l.row === 'front')
    .map((l) => {
      // Behind the top: past the back row and the seating overhang.
      const back = (l.island.type === 'double' ? 700 : 0) + (l.island.overhang ?? 0) + font * 2;
      const at = [l.origin[0] + l.u[0] * (l.length / 2) - l.n[0] * back, l.origin[1] + l.u[1] * (l.length / 2) - l.n[1] * back];
      pts.push(at);
      return s('text', { class: 'dw-text pl-label', x: at[0], y: at[1], 'font-size': font, 'text-anchor': 'middle' }, l.island.name);
    });

  const content = [walls, tops, cabinets, islandLabels];
  const xs = pts.map((q) => q[0]);
  const zs = pts.map((q) => q[1]);
  const [x0, x1, z0, z1] = [Math.min(0, ...xs), Math.max(1000, ...xs), Math.min(0, ...zs), Math.max(1000, ...zs)];
  const margin = 400;
  mount(
    container,
    h(
      'div',
      { class: 'plan-layout' },
      s(
        'svg',
        {
          class: 'plan',
          viewBox: `${x0 - margin} ${z0 - margin} ${x1 - x0 + 2 * margin} ${z1 - z0 + 2 * margin}`,
          preserveAspectRatio: 'xMidYMid meet',
        },
        content,
      ),
      roomEditor(p),
    ),
  );
}
