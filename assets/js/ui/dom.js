// Tiny DOM helpers: h() for HTML, s() for SVG. Props starting with "on" are
// event listeners; other props are set as properties when the element has
// them (value, checked, disabled…) and as attributes otherwise. Props are
// applied after children so <select value> picks the right option.

import { fmtMm } from '../engine/model.js';
import { fmtLen, isImperial, parseLen } from '../engine/units.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(el.style, v);
    } else if (k === 'class') {
      el.setAttribute('class', v);
    } else if (!(el instanceof SVGElement) && k in el && !k.includes('-')) {
      el[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : v);
    }
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  append(el, children);
  applyProps(el, props);
  return el;
}

export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  append(el, children);
  applyProps(el, props);
  return el;
}

// Inputs the user has typed into but not yet committed (no change event).
document.addEventListener('input', (e) => e.target.dataset && (e.target.dataset.dirty = '1'), true);
document.addEventListener('change', (e) => e.target.dataset && delete e.target.dataset.dirty, true);

/**
 * Replaces a container's content, keeping keyboard focus (and any
 * uncommitted typing) on the element with the same data-key so re-renders
 * don't interrupt the user.
 */
export function mount(container, ...nodes) {
  const active = document.activeElement;
  const key = container.contains(active) ? active?.dataset?.key : null;
  const typed = key && active.dataset.dirty ? active.value : null;
  let selection = null;
  if (key && typeof active.selectionStart === 'number') {
    try {
      selection = [active.selectionStart, active.selectionEnd];
    } catch {
      // number inputs don't expose a selection
    }
  }
  container.replaceChildren();
  append(container, nodes);
  if (key) {
    const next = container.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (next) {
      if (typed !== null) {
        next.value = typed;
        next.dataset.dirty = '1';
      }
      next.focus({ preventScroll: true });
      if (selection) next.setSelectionRange?.(...selection);
    }
  }
}

// Standard imperial cabinet sizes and their metric equivalents (mm).
export const STANDARD_SIZES = [
  [6, 152],
  [9, 229],
  [12, 305],
  [15, 381],
  [18, 457],
  [21, 533],
  [24, 610],
  [30, 762],
  [36, 914],
];

/** A small reference table of the standard sizes, inches to mm. */
export function sizeReference() {
  return h(
    'div',
    { class: 'size-ref' },
    h('span', { class: 'muted' }, 'Standard sizes'),
    h(
      'table',
      {},
      h('tr', {}, h('th', {}, 'in'), STANDARD_SIZES.map(([inch]) => h('td', {}, `${inch}″`))),
      h('tr', {}, h('th', {}, 'mm'), STANDARD_SIZES.map(([, mm]) => h('td', {}, String(mm)))),
    ),
  );
}

/** Number input that commits on change (Enter, blur or spinner). */
export function numField(label, key, value, onCommit, { step = 1, wide = false, format = fmtMm } = {}) {
  const input = h('input', {
    type: 'number',
    step,
    'data-key': key,
    value: format(value ?? 0),
    onchange: (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) onCommit(v);
      else e.target.value = format(value ?? 0);
    },
  });
  return h('label', { class: wide ? 'field wide' : 'field' }, h('span', {}, label), input);
}

/**
 * Attributes for a length input (a value in mm): a number box in mm; in
 * inches a text box that shows 23 5/8" and reads 23.5, 23 1/2, 4' 6", 600mm.
 * `metric` keeps it in mm whatever the display units (32mm system, drawer
 * units, material thickness). onCommit gets millimetres.
 */
export function lenInput(value, onCommit, { metric = false, step = 1, key, mmFormat = fmtMm, ...attrs } = {}) {
  const shown = () => (metric || !isImperial() ? mmFormat(value ?? 0) : fmtLen(value ?? 0));
  const base = { ...(key ? { 'data-key': key } : {}), ...attrs };
  if (metric || !isImperial()) {
    return {
      ...base,
      type: 'number',
      step,
      value: shown(),
      onchange: (e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onCommit(v);
        else e.target.value = shown();
      },
    };
  }
  delete base.min;
  delete base.max;
  return {
    ...base,
    type: 'text',
    inputmode: 'decimal',
    class: 'len',
    spellcheck: 'false',
    autocomplete: 'off',
    title: `${fmtMm(value ?? 0)} mm`,
    value: shown(),
    onchange: (e) => {
      const v = parseLen(e.target.value);
      if (Number.isFinite(v)) onCommit(v);
      else e.target.value = shown();
    },
  };
}

/** A labelled length field (value in mm); see lenInput. */
export function lenField(label, key, value, onCommit, { wide = false, ...opts } = {}) {
  return h('label', { class: wide ? 'field wide' : 'field' }, h('span', {}, label), h('input', lenInput(value, onCommit, { key, ...opts })));
}

export function textField(label, key, value, onCommit, { wide = false } = {}) {
  return h(
    'label',
    { class: wide ? 'field wide' : 'field' },
    h('span', {}, label),
    h('input', { 'data-key': key, value, onchange: (e) => onCommit(e.target.value) }),
  );
}

/** options: [[value, label], …] */
export function selectField(label, key, options, current, onCommit, { wide = false } = {}) {
  return h(
    'label',
    { class: wide ? 'field wide' : 'field' },
    h('span', {}, label),
    h(
      'select',
      { 'data-key': key, value: String(current), onchange: (e) => onCommit(e.target.value) },
      options.map(([v, l]) => h('option', { value: String(v) }, l)),
    ),
  );
}

export function checkboxField(label, key, checked, onCommit) {
  return h(
    'label',
    { class: 'field' },
    h('span', {}, label),
    h('input', { type: 'checkbox', 'data-key': key, checked, onchange: (e) => onCommit(e.target.checked) }),
  );
}

const GEAR_PATH =
  'M19.14 12.94a7.07 7.07 0 0 0 .06-.94 7.07 7.07 0 0 0-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.62l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54a7.3 7.3 0 0 0-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.71 8.86a.48.48 0 0 0 .12.62l2.03 1.58a7.3 7.3 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.62l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54a7.3 7.3 0 0 0 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.62zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z';

export function gearIcon(size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', GEAR_PATH);
  svg.append(path);
  return svg;
}

/** Triggers a browser download of `contents`. */
export function download(filename, mime, contents) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
