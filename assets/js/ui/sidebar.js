// Left panel: the cabinet list, grouped by wall and island. Each row's gear
// (or a double-click) opens the cabinet dialog with its size, fronts and
// construction. New cabinets go to the current wall or island.

import { newCorner } from '../engine/corner.js';
import { DEFAULT_FILLER_WIDTH, SPACE_PRESETS, fmtMm, newCabinet, newFiller, newPanel, newSpace, runOf } from '../engine/model.js';
import { addCabinet, atOf, insertCabinet, moveCabinet, relayout } from '../engine/project.js';
import { addWall, locations } from '../engine/room.js';
import { RUN_LABELS, countOverrides } from './cabinetdialog.js';
import { gearIcon, h, mount } from './dom.js';
import { currentAt, select, setState, state, toggleSelect, updateProject } from './store.js';
import { fmtLen, isImperial } from '../engine/units.js';

// New cabinets take their sizes from the job construction.
const job = () => state.project.construction;

function add(spec) {
  let index = 0;
  spec.at = currentAt();
  updateProject((p) => {
    index = addCabinet(p, spec);
  });
  select(index);
}

// Index of the cabinet being dragged in the list.
let dragFrom = null;

// The "Other" menu: fillers, standing panels and spaces, each inserted at
// its usual width (changed in its settings). A panel is as wide as the
// front material is thick.
const OTHER_ITEMS = [
  { id: 'space', label: 'Space', title: 'Room left in the base run', width: SPACE_PRESETS.space.width },
  { id: 'filler', label: 'Filler', title: 'A filler strip, flush with the doors', width: DEFAULT_FILLER_WIDTH },
  { id: 'panel', label: 'Panel', title: 'A finished end panel standing on its own (beside a dishwasher, say)' },
  { id: 'dishwasher', label: 'Dishwasher', title: 'A dishwasher space; the countertop runs over it', width: SPACE_PRESETS.dishwasher.width },
  { id: 'range', label: 'Range', title: 'A range space; the countertop stops at it', width: SPACE_PRESETS.range.width },
  { id: 'fridge', label: 'Fridge', title: 'A fridge space in the tall run', width: SPACE_PRESETS.fridge.width },
];
let otherOpen = false;

// A click anywhere outside the menu closes it.
globalThis.document?.addEventListener('click', (e) => {
  const menu = document.querySelector('details.other-menu[open]');
  if (menu && !menu.contains(e.target)) {
    otherOpen = false;
    menu.open = false;
  }
});

/** Moves a cabinet in the list (and on the wall), keeping the selection.
 *  With `at`, it also moves to that wall or island. */
function move(from, to, at = null) {
  const selectedId = state.project.cabinets[state.selected]?.id;
  updateProject((p) => {
    if (at) p.cabinets[from].at = at;
    moveCabinet(p, from, to);
    relayout(p);
  });
  select(selectedId == null ? -1 : state.project.cabinets.findIndex((c) => c.id === selectedId));
}

function cabinetRow(c, i) {
  const { built, selected } = state;
  const clearMarks = (el) => el.classList.remove('drop-before', 'drop-after');
  const after = (e) => e.offsetY > e.currentTarget.clientHeight / 2;
  return h(
    'li',
    {
      class: [i === selected ? 'active' : '', c.kind === 'filler' || c.kind === 'space' ? 'filler' : ''].join(' ').trim() || null,
      draggable: true,
      title: 'Drag to reorder',
      onclick: () => toggleSelect(i),
      ondblclick: () => setState({ selected: i, selectedPart: null, cabDialog: 'cabinet' }),
      ondragstart: (e) => {
        dragFrom = i;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        e.currentTarget.classList.add('dragging');
      },
      ondragend: (e) => {
        dragFrom = null;
        e.currentTarget.classList.remove('dragging');
      },
      ondragover: (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clearMarks(e.currentTarget);
        e.currentTarget.classList.add(after(e) ? 'drop-after' : 'drop-before');
      },
      ondragleave: (e) => clearMarks(e.currentTarget),
      ondrop: (e) => {
        e.preventDefault();
        clearMarks(e.currentTarget);
        if (dragFrom === null) return;
        let to = after(e) ? i + 1 : i;
        if (dragFrom < to) to -= 1;
        const from = dragFrom;
        dragFrom = null;
        // Dropped among another wall's cabinets: it moves there.
        move(from, to, atOf(state.project, c));
      },
    },
    h('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮'),
    h('span', { class: built[i]?.error ? 'err' : null }, c.name),
    countOverrides(c.overrides) ? h('span', { class: 'badge', title: 'Has its own construction settings' }, 'custom') : null,
    h(
      'span',
      { class: 'dims' },
      c.panel
        ? `${fmtLen(c.width)} · panel`
        : c.kind === 'filler'
        ? `${fmtLen(c.width)} · ${RUN_LABELS[c.run].toLowerCase()}`
        : c.kind === 'space'
          ? `${fmtLen(c.width)} · space`
          : isImperial() ? `${fmtLen(c.width)} × ${fmtLen(c.height)} × ${fmtLen(c.depth)}` : `${fmtMm(c.width)}×${fmtMm(c.height)}×${fmtMm(c.depth)}`,
    ),
    h(
      'button',
      {
        class: `icon-btn row-gear${countOverrides(c.overrides) ? ' custom' : ''}`,
        draggable: false,
        title: `Construction: ${c.name}`,
        'aria-label': `Construction settings for ${c.name}`,
        onclick: (e) => {
          e.stopPropagation();
          setState({ selected: i, selectedPart: null, cabDialog: 'cabinet' });
        },
      },
      gearIcon(16),
    ),
  );
}

/** Adds a wall to the room; new cabinets go to it. */
function addRoomWall() {
  let id;
  otherOpen = false;
  updateProject((p) => {
    id = addWall(p);
    relayout(p);
  });
  setState({ at: id });
}

/** "+ Other ▾": a menu of fillers, panels and spaces, and a room wall. */
function otherMenu(addOther) {
  const row = (item) =>
    h(
      'button',
      { type: 'button', class: 'other-item', title: `${item.title}. Inserted after the selected cabinet.`, onclick: () => addOther(item) },
      item.label,
    );
  return h(
    'details',
    { class: 'other-menu', open: otherOpen, ontoggle: (e) => (otherOpen = e.currentTarget.open) },
    h('summary', { title: 'Fillers, panels and spaces for appliances' }, '+ Other', h('span', { class: 'caret', 'aria-hidden': 'true' }, '▾')),
    h(
      'div',
      { class: 'other-list' },
      OTHER_ITEMS.map(row),
      h('hr', { class: 'other-sep' }),
      h('button', { type: 'button', class: 'other-item', title: 'Add a wall to the room after the last one (inside corner); set its length and corner in the Plan view', onclick: addRoomWall }, 'Room wall'),
    ),
  );
}

function cabinetList() {
  const { project } = state;
  const n = project.cabinets.length;
  const sel = state.selected;
  // -1: no cabinet selected.
  const has = !!project.cabinets[sel];
  const here = currentAt();
  const duplicate = () => {
    const spec = project.cabinets[sel];
    if (!spec) return;
    // Right after the original, which pushes the rest of its run along.
    updateProject((p) => insertCabinet(p, { ...structuredClone(spec), name: `${spec.name} copy` }, sel + 1));
    select(sel + 1);
  };
  const remove = () => {
    if (!has) return;
    updateProject((p) => {
      p.cabinets.splice(sel, 1);
      relayout(p);
    });
    select(Math.max(0, sel - 1));
  };
  // Fillers, panels and spaces go right after the selected cabinet; their
  // own Run and Place after settings move them from there. Fillers and
  // panels take the selected cabinet's run (base for a tall one).
  const addOther = (item) => {
    const spec = project.cabinets[sel];
    const at = spec ? sel + 1 : n;
    const run = spec ? (runOf(spec) === 'tall' ? 'base' : runOf(spec)) : 'base';
    const width = item.width;
    otherOpen = false;
    updateProject((p) => {
      const c = p.construction;
      const made = item.id === 'filler' ? newFiller(run, 0, c, width) : item.id === 'panel' ? newPanel(run, 0, c) : newSpace(item.id, 0, c);
      insertCabinet(p, made, at);
    });
    select(at);
  };
  return [
    h('h3', {}, 'Add cabinet'),
    h(
      'div',
      { class: 'add-row' },
      h('button', { onclick: () => add(newCabinet('base', 0, job())) }, '+ Base'),
      h('button', { onclick: () => add(newCabinet('wall', 0, job())) }, '+ Wall'),
      h('button', { onclick: () => add(newCabinet('tall', 0, job())) }, '+ Tall'),
      h('button', { onclick: () => add(newCorner('base', 0, job())), title: 'L-shaped corner base for the end of a wall: two doors' }, '+ Corner base'),
      h('button', { onclick: () => add(newCorner('wall', 0, job())), title: 'Corner wall cabinet for the end of a wall: one 45° door' }, '+ Corner wall'),
      otherMenu(addOther),
    ),
    h('h3', {}, 'Cabinets'),
    h(
      'p',
      { class: 'muted hint-small' },
      'Grouped by wall and island; new cabinets go to the highlighted one. Drag to reorder (or onto another wall). ⚙ or double-click edits a cabinet; click the selected one again (or Esc) to select none.',
    ),
    locations(project).map((loc) => {
      const rows = project.cabinets.map((c, i) => [c, i]).filter(([c]) => atOf(project, c) === loc.id);
      return [
        h(
          'button',
          {
            class: loc.id === here ? 'loc-head active' : 'loc-head',
            title: `Add new cabinets to ${loc.name}`,
            onclick: () => setState({ at: loc.id }),
          },
          loc.name,
          h('span', { class: 'dims' }, loc.kind === 'wall' ? fmtLen(loc.length) : `${fmtLen(loc.length)} island`),
        ),
        rows.length ? h('ul', { class: 'cab-list' }, rows.map(([c, i]) => cabinetRow(c, i))) : h('p', { class: 'muted hint-small loc-empty' }, 'No cabinets yet.'),
      ];
    }),
    h(
      'div',
      { class: 'add-row', style: { marginTop: '6px' } },
      h('button', { onclick: () => move(sel, sel - 1), disabled: !has || sel <= 0, 'aria-label': 'Move up' }, '↑ Up'),
      h('button', { onclick: () => move(sel, sel + 1), disabled: !has || sel >= n - 1, 'aria-label': 'Move down' }, '↓ Down'),
      h('button', { onclick: duplicate, disabled: !has }, 'Duplicate'),
      h('button', { class: 'danger', onclick: remove, disabled: !has }, 'Delete'),
    ),
  ];
}

export function renderSidebar(container) {
  mount(container, cabinetList());
}
