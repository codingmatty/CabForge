// Machining drawing of one part: x along the length, y across the width.
// Case sides get a shop drawing instead: standing up, inside face, every
// hole dimensioned from the bottom and front edges.

import { effectiveConstruction, fmtMm } from '../engine/model.js';
import { bores, edgeCode } from '../engine/part.js';
import { jobFor } from '../engine/project.js';
import { h, mount, s } from './dom.js';
import { setState, state } from './store.js';
import { fmtLen, fmtLenU, fmtSize, isImperial } from '../engine/units.js';

const PURPOSE_LABELS = { system: 'System hole', hingeCup: 'Hinge cup', hingePlate: 'Hinge plate', slide: 'Drawer slide' };
const isSide = (part) => part.role === 'leftSide' || part.role === 'rightSide';

/** Prints the part drawing on its own (see body.print-drawing in app.css). */
function printDrawing() {
  document.body.classList.add('print-drawing');
  window.addEventListener('afterprint', () => document.body.classList.remove('print-drawing'), { once: true });
  window.print();
}

/**
 * Hinge cup dimensions for a door drawing, outside the hinge edge: each cup
 * centre's distance from the door bottom (x = 0), and the first cup's
 * centre from the hinge edge. `band` is the room they take.
 */
function cupDimensions(part, font) {
  const cups = bores(part)
    .filter((b) => b.purpose === 'hingeCup')
    .sort((a, b) => a.x - b.x);
  if (!cups.length) return { shapes: [], band: 0, hingeTop: false };
  const w = part.width;
  const hingeTop = cups[0].y < w / 2;
  const edge = hingeTop ? 0 : w;
  const dir = hingeTop ? -1 : 1; // outwards from the hinge edge
  const [ext, run] = [font * 0.6, font * 1.6];
  const labelY = edge + dir * (ext + run + font * 0.4) + (hingeTop ? 0 : font * 0.8);
  const xs = [0, ...cups.map((b) => b.x)];
  const labels = spread(xs, font * 2.6);
  const shapes = xs.map((x, i) => {
    const cup = cups[i - 1];
    const from = cup ? cup.y + dir * (cup.diameter / 2) : edge;
    const [y1, y2] = [edge + dir * ext, edge + dir * (ext + run)];
    return [
      s('polyline', { class: 'dw-ext', points: `${x},${from} ${x},${y1} ${x},${y1 + dir * run * 0.35} ${labels[i]},${y2}` }),
      s('text', { class: cup ? 'dw-text' : 'dw-muted', x: labels[i], y: labelY, 'font-size': font, 'text-anchor': 'middle' }, fmtMm(x)),
    ];
  });

  // Hinge edge to the first cup's centre, beside that cup.
  const first = cups[0];
  const dx = first.x + first.diameter / 2 + font * 1.2;
  const tick = font * 0.4;
  const dist = Math.abs(first.y - edge);
  shapes.push(
    s('line', { class: 'dw-ext', x1: first.x, y1: first.y, x2: dx + tick, y2: first.y }),
    s('line', { class: 'dw-dim', x1: dx, y1: edge, x2: dx, y2: first.y }),
    [edge, first.y].map((y) => s('line', { class: 'dw-dim', x1: dx - tick, y1: y, x2: dx + tick, y2: y })),
    s('text', { class: 'dw-text', x: dx + font * 0.5, y: (edge + first.y) / 2 + font * 0.35, 'font-size': font }, fmtMm(dist)),
    s(
      'text',
      { class: 'dw-muted', x: 0, y: edge + dir * (ext + run + font * 2.2) + (hingeTop ? 0 : font * 0.8), 'font-size': font * 0.8 },
      `Hinge edge · cups Ø${fmtMm(first.diameter)} × ${fmtMm(first.depth)} · centres from door bottom`,
    ),
  );
  return { shapes, band: ext + run + font * 3.2, hingeTop };
}

/** Each edge of a shaped panel's outline, labelled with its length inside the part. */
function outlineDimensions(outline, font) {
  const ccw = outline.reduce((a, p, i) => a + p[0] * outline[(i + 1) % outline.length][1] - outline[(i + 1) % outline.length][0] * p[1], 0) > 0;
  return outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < font * 3) return null;
    // The part lies to the left of each edge of a counter-clockwise outline.
    const inward = ccw ? [-(b[1] - a[1]) / len, (b[0] - a[0]) / len] : [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
    const [mx, my] = [(a[0] + b[0]) / 2 + inward[0] * font * 1.4, (a[1] + b[1]) / 2 + inward[1] * font * 1.4];
    return s('text', { class: 'dw-muted', x: mx, y: my, 'font-size': font * 0.85, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, fmtLen(len));
  });
}

function drawing(part) {
  const [l, w] = [part.length, part.width];
  const margin = Math.max(60, Math.max(l, w) * 0.08);
  const font = Math.max(10, Math.max(l, w) * 0.022);
  const cups = cupDimensions(part, font);
  const [padTop, padBottom] = cups.hingeTop ? [cups.band, 0] : [0, cups.band];
  const e = part.edges;
  // A shaped panel's edges aren't the four sides of its rectangle: no band lines.
  const band = (on, x1, y1, x2, y2) => (on && !part.outline ? s('line', { class: 'dw-band', x1, y1, x2, y2 }) : null);
  const features = part.ops.map((op) => {
    switch (op.type) {
      case 'groove':
        return s('rect', { class: 'dw-groove', x: 0, y: op.y, width: l, height: op.width });
      case 'pocket':
      case 'rabbet':
        return s('rect', { class: 'dw-pocket', x: op.x, y: op.y, width: op.length, height: op.width });
      case 'opening':
        return s('rect', { class: 'dw-notch', x: op.x, y: op.y, width: op.length, height: op.width });
      default:
        return null;
    }
  });
  // A shaker frame: the opening's size inside it, the frame width across one stile.
  const opening = part.ops.find((op) => op.type === 'opening');
  const frameDims = opening
    ? [
        s('text', { class: 'dw-text', x: l / 2, y: w / 2 - font * 0.3, 'font-size': font, 'text-anchor': 'middle' }, `Opening ${fmtSize(opening.length, opening.width)}`),
        s('text', { class: 'dw-muted', x: l / 2, y: w / 2 + font, 'font-size': font * 0.8, 'text-anchor': 'middle' }, 'cut through'),
        s('line', { class: 'dw-dim', x1: l / 2, y1: 0, x2: l / 2, y2: opening.y }),
        s('text', { class: 'dw-text', x: l / 2 + font * 0.4, y: opening.y / 2 + font * 0.35, 'font-size': font }, fmtLen(opening.y)),
      ]
    : null;
  const shape = part.cornerRadius
    ? s('rect', { class: 'dw-part', x: 0, y: 0, width: l, height: w, rx: part.cornerRadius })
    : part.outline
      ? s('polygon', { class: 'dw-part', points: part.outline.map((q) => q.join(',')).join(' ') })
      : s('rect', { class: 'dw-part', x: 0, y: 0, width: l, height: w });
  return s(
    'svg',
    { viewBox: `${-margin} ${-margin - padTop} ${l + 2 * margin} ${w + 2 * margin + padTop + padBottom}`, preserveAspectRatio: 'xMidYMid meet' },
    shape,
    part.outline && !part.cornerRadius ? outlineDimensions(part.outline, font) : null,
    features,
    frameDims,
    band(e.l1, 0, 0, l, 0),
    band(e.l2, 0, w, l, w),
    band(e.w1, 0, 0, 0, w),
    band(e.w2, l, 0, l, w),
    bores(part).map((b) => s('circle', { class: `bore-${b.purpose}`, cx: b.x, cy: b.y, r: b.diameter / 2 })),
    cups.shapes,
    s('line', { class: 'dw-dim', x1: 0, y1: -margin * 0.45 - padTop, x2: l, y2: -margin * 0.45 - padTop }),
    s('text', { class: 'dw-text', x: l / 2, y: -margin * 0.55 - padTop, 'font-size': font, 'text-anchor': 'middle' }, `L ${fmtLen(l)}`),
    s('line', { class: 'dw-dim', x1: -margin * 0.45, y1: 0, x2: -margin * 0.45, y2: w }),
    s(
      'text',
      {
        class: 'dw-text',
        x: -margin * 0.55,
        y: w / 2,
        'font-size': font,
        'text-anchor': 'middle',
        transform: `rotate(-90 ${-margin * 0.55} ${w / 2})`,
      },
      `W ${fmtLen(w)}`,
    ),
    s('text', { class: 'dw-muted', x: 0, y: w + margin * 0.55 + padBottom, 'font-size': font * 0.8 }, 'x → length · y ↓ width · L1 at top edge'),
  );
}

// ---- case sides: dimensioned drilling drawing ------------------------------

// Case parts that butt against the sides, drawn dashed for reference.
const JOINED_ROLES = ['bottom', 'top', 'frontStretcher', 'rearStretcher', 'fixedShelf', 'back'];

/** Spreads label positions (sorted) so they are at least `gap` apart. */
function spread(positions, gap) {
  const out = [];
  for (const p of positions) out.push(out.length ? Math.max(p, out[out.length - 1] + gap) : p);
  // Centre the shift on the original positions so labels don't all drift one way.
  const drift = (out.reduce((a, v) => a + v, 0) - positions.reduce((a, v) => a + v, 0)) / (out.length || 1);
  return out.map((v) => v - drift);
}

const unique = (values) => [...new Set(values.map((v) => Math.round(v * 10) / 10))].sort((a, b) => a - b);

/**
 * The inside (drilled) face of a case side, standing up: height from the
 * bottom edge, depth from the front edge. The left side is seen from the
 * right, so its front edge is on the left; the right side is mirrored.
 * Holes are dimensioned by ordinates from those two edges.
 */
function sideDrawing(cab, side, opts) {
  const [L, W] = [side.length, side.width];
  const frontLeft = side.role === 'leftSide';
  const X = (fromFront) => (frontLeft ? fromFront : W - fromFront);
  const Y = (fromBottom) => L - fromBottom;
  const font = Math.max(10, Math.max(L, W) * 0.016);
  const holes = bores(side).filter((b) => opts.show[b.purpose]);
  const featured = holes.filter((b) => b.purpose !== 'system');
  const system = holes.filter((b) => b.purpose === 'system');

  // Heights to dimension: every hinge and slide row, and the first and last
  // system hole on each system line.
  const heights = featured.map((b) => b.x);
  for (const y of unique(system.map((b) => b.y))) {
    const xs = system.filter((b) => Math.abs(b.y - y) < 0.05).map((b) => b.x);
    heights.push(Math.min(...xs), Math.max(...xs));
  }
  const rows = unique(heights);
  const cols = unique(holes.map((b) => b.y));

  const ext = font * 0.8; // gap between the part and the start of a leader
  const run = font * 2.5; // leader length to the labels
  const labelRoom = font * 4.5;
  const marginFront = ext + run + labelRoom;
  const marginBack = font * 3.5;
  const marginBottom = ext + run + labelRoom + font * 5;
  const marginTop = font * 3.5;
  const [vx, vw] = frontLeft ? [-marginFront, W + marginFront + marginBack] : [-marginBack, W + marginFront + marginBack];
  const shapes = [];
  const dir = frontLeft ? -1 : 1; // outwards from the front edge
  const frontX = X(0);

  // Height ordinates beside the front edge.
  const rowsByY = rows.slice().reverse(); // top of the drawing first
  const rowLabels = spread(rowsByY.map(Y), font * 1.15);
  rowsByY.forEach((r, i) => {
    const y = Y(r);
    const nearest = Math.min(...holes.filter((b) => Math.abs(b.x - r) < 0.05).map((b) => b.y), W);
    const x0 = X(nearest);
    const [x1, x2] = [frontX + dir * ext, frontX + dir * (ext + run)];
    shapes.push(
      s('polyline', { class: 'dw-ext', points: `${x0},${y} ${x1},${y} ${x1 + dir * run * 0.35},${y} ${x2},${rowLabels[i]}` }),
      s(
        'text',
        { class: 'dw-text', x: x2 + dir * font * 0.3, y: rowLabels[i] + font * 0.35, 'font-size': font, 'text-anchor': frontLeft ? 'end' : 'start' },
        fmtMm(r),
      ),
    );
  });

  // Depth ordinates under the bottom edge.
  const colXs = cols.map(X);
  const order = colXs.map((x, i) => i).sort((a, b) => colXs[a] - colXs[b]);
  const colLabels = spread(order.map((i) => colXs[i]), font * 1.15);
  order.forEach((ci, k) => {
    const col = cols[ci];
    const x = colXs[ci];
    const lowest = Math.min(...holes.filter((b) => Math.abs(b.y - col) < 0.05).map((b) => b.x));
    const [y1, y2] = [L + ext, L + ext + run];
    const lx = colLabels[k];
    shapes.push(
      s('polyline', { class: 'dw-ext', points: `${x},${Y(lowest)} ${x},${y1} ${x},${y1 + run * 0.35} ${lx},${y2}` }),
      s(
        'text',
        { class: 'dw-text', x: lx + font * 0.35, y: y2 + font * 0.3, 'font-size': font, 'text-anchor': 'end', transform: `rotate(-90 ${lx + font * 0.35} ${y2 + font * 0.3})` },
        fmtMm(col),
      ),
    );
  });

  // Datum marks: 0 at the bottom and front edges.
  shapes.push(
    s('text', { class: 'dw-muted', x: frontX + dir * (ext + run + font * 0.3), y: L + font * 0.35, 'font-size': font * 0.85, 'text-anchor': frontLeft ? 'end' : 'start' }, '0'),
  );

  // Overall size, as on the other part drawings: W (depth) across the top,
  // L (height) along the back edge.
  const tick = font * 0.4;
  const dimY = -font * 1.9;
  const backDir = -dir;
  const dimX = X(W) + backDir * font * 1.5;
  // Read bottom to top: the glyphs sit on the left of the rotated baseline.
  const lx = dimX + (backDir > 0 ? font * 1.1 : -font * 0.4);
  shapes.push(
    s('line', { class: 'dw-dim', x1: 0, y1: dimY, x2: W, y2: dimY }),
    [0, W].map((x) => s('line', { class: 'dw-dim', x1: x, y1: dimY - tick, x2: x, y2: dimY + tick })),
    s('text', { class: 'dw-text', x: W / 2, y: dimY - font * 0.4, 'font-size': font, 'text-anchor': 'middle' }, `W ${fmtLen(W)}`),
    s('line', { class: 'dw-dim', x1: dimX, y1: 0, x2: dimX, y2: L }),
    [0, L].map((y) => s('line', { class: 'dw-dim', x1: dimX - tick, y1: y, x2: dimX + tick, y2: y })),
    s(
      'text',
      {
        class: 'dw-text',
        x: lx,
        y: L / 2,
        'font-size': font,
        'text-anchor': 'middle',
        transform: `rotate(-90 ${lx} ${L / 2})`,
      },
      `L ${fmtLen(L)}`,
    ),
  );

  const joined = opts.joined
    ? cab.parts
        // Parts in the side's own frame (a corner cabinet's return has its own).
        .filter((p) => JOINED_ROLES.includes(p.role) && (p.frame ?? null) === (side.frame ?? null))
        .map((p) => {
          const y0 = p.bbox.min[1] - side.bbox.min[1];
          // From the front, within the side (a corner's L bottom runs on past it).
          const z1 = Math.min(W, W - p.bbox.min[2]);
          const z0 = Math.max(0, W - (p.bbox.min[2] + p.bbox.size[2]));
          const [xa, xb] = [X(z0), X(z1)].sort((a, b) => a - b);
          return s('rect', { class: 'dw-hidden', x: xa, y: Y(y0 + p.bbox.size[1]), width: xb - xa, height: p.bbox.size[1] });
        })
    : [];

  // Stretchers, full panels and fixed shelves between the fronts: a centre
  // line, its height from the bottom edge labelled at the back edge.
  const dividers = cab.parts
    .filter((p) => p.divider && (p.frame ?? null) === (side.frame ?? null))
    .map((p) => {
      const c = p.bbox.min[1] + p.bbox.size[1] / 2 - side.bbox.min[1];
      const tx = X(W) + dir * font * 0.4;
      return s(
        'g',
        {},
        s('line', { class: 'dw-center', x1: 0, y1: Y(c), x2: W, y2: Y(c) }),
        s('text', { class: 'dw-text', x: tx, y: Y(c) - p.bbox.size[1] / 2 - font * 0.3, 'font-size': font * 0.85, 'text-anchor': frontLeft ? 'end' : 'start' }, `${p.name} ℄ ${fmtMm(c)}`),
      );
    });

  const titleY = L + ext + run + labelRoom + font * 1.6;
  return s(
    'svg',
    {
      class: 'side-drawing',
      viewBox: `${vx} ${-marginTop} ${vw} ${L + marginTop + marginBottom}`,
      preserveAspectRatio: 'xMidYMid meet',
    },
    s('rect', { class: 'dw-part', x: 0, y: 0, width: W, height: L }),
    s('line', { class: 'dw-band', x1: frontX, y1: 0, x2: frontX, y2: L }),
    // Notches cut through (the toe kick), shown cut away and sized.
    side.ops
      .filter((op) => op.type === 'pocket' && op.depth >= side.thickness - 0.05)
      .map((op) => {
        const [xa, xb] = [X(op.y), X(op.y + op.width)].sort((a, b) => a - b);
        const [cx, cy] = [(xa + xb) / 2, Y(op.x + op.length / 2)];
        return s(
          'g',
          {},
          s('rect', { class: 'dw-notch', x: xa, y: Y(op.x + op.length), width: xb - xa, height: op.length }),
          s('text', { class: 'dw-muted', x: cx, y: cy, 'font-size': font * 0.75, 'text-anchor': 'middle' }, fmtSize(op.width, op.length)),
        );
      }),
    joined,
    dividers,
    shapes,
    holes.map((b) => s('circle', { class: `bore-${b.purpose}`, cx: X(b.y), cy: Y(b.x), r: Math.max(b.diameter / 2, font * 0.12) })),
    s(
      'text',
      { class: 'dw-muted', x: frontX + dir * -font * 0.4, y: -font * 0.6, 'font-size': font * 0.85, 'text-anchor': frontLeft ? 'start' : 'end' },
      'FRONT',
    ),
    s(
      'text',
      { class: 'dw-text', x: W / 2, y: titleY, 'font-size': font * 1.1, 'text-anchor': 'middle', 'font-weight': 600 },
      `${cab.name} — ${side.name}`,
    ),
    s(
      'text',
      { class: 'dw-muted', x: W / 2, y: titleY + font * 1.4, 'font-size': font * 0.85, 'text-anchor': 'middle' },
      `${fmtSize(L, W)} × ${fmtMm(side.thickness)}${isImperial() ? ' mm' : ''} · inside face · hole heights from bottom edge, depths from front edge${isImperial() ? ', in mm' : ''}`,
    ),
    system.length
      ? s(
          'text',
          { class: 'dw-muted', x: W / 2, y: titleY + font * 2.6, 'font-size': font * 0.85, 'text-anchor': 'middle' },
          `System holes Ø${fmtMm(system[0].diameter)} × ${fmtMm(system[0].depth)} at ${fmtMm(opts.spacing)} c/c between the dimensioned ends`,
        )
      : null,
  );
}

/** Options panel for a case side: side switch, what to show, hole table. */
function sideOps(cab, side, opts) {
  const setOpts = (patch) => setState({ sideDrawing: { ...opts, ...patch } });
  const toggle = (key, label, cssVar) =>
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        'data-key': `sd-${key}`,
        checked: opts.show[key],
        onchange: (e) => setOpts({ show: { ...opts.show, [key]: e.target.checked } }),
      }),
      h('i', { class: 'swatch', style: { background: `var(${cssVar})` } }),
      label,
      ` (${bores(side).filter((b) => b.purpose === key).length})`,
    );
  const holes = bores(side)
    .filter((b) => opts.show[b.purpose])
    .sort((a, b) => a.x - b.x || a.y - b.y);
  return [
    h(
      'div',
      { class: 'tabs segmented' },
      ['leftSide', 'rightSide'].map((role) =>
        h(
          'button',
          { class: side.role === role ? 'active' : null, onclick: () => setState({ selectedPart: cab.parts.findIndex((p) => p.role === role) }) },
          role === 'leftSide' ? 'Left side' : 'Right side',
        ),
      ),
    ),
    h('h3', {}, 'Show'),
    toggle('hingePlate', 'Hinge plates', '--bore-plate'),
    toggle('slide', 'Drawer slides', '--bore-slide'),
    toggle('system', 'System holes', '--bore-system'),
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', 'data-key': 'sd-joined', checked: opts.joined, onchange: (e) => setOpts({ joined: e.target.checked }) }),
      h('i', { class: 'swatch hidden-line' }),
      'Bottom, top & back (dashed)',
    ),
    h('h3', {}, `Holes (${holes.length})`),
    holes.length
      ? h(
          'table',
          { class: 'hole-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Bore'), ['From bottom', 'From front', 'Ø × depth'].map((t) => h('th', { class: 'num' }, isImperial() ? `${t} (mm)` : t)))),
          h(
            'tbody',
            {},
            holes.map((b) =>
              h(
                'tr',
                {},
                h('td', {}, PURPOSE_LABELS[b.purpose] ?? b.purpose),
                h('td', { class: 'num' }, fmtMm(b.x)),
                h('td', { class: 'num' }, fmtMm(b.y)),
                h('td', { class: 'num' }, `${fmtMm(b.diameter)} × ${fmtMm(b.depth)}`),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'No holes to show.'),
  ];
}

export function renderPartView(container) {
  const cab = state.built[state.selected]?.cabinet;
  const part = cab?.parts[state.selectedPart ?? 0];
  if (!part) {
    mount(container, h('p', { class: 'hint' }, 'Select a part in the table below.'));
    return;
  }
  const notes = part.ops
    .map((op) => {
      if (op.type === 'groove') return `Groove at y ${fmtLen(op.y)} · ${fmtLen(op.width)} wide · ${fmtLen(op.depth)} deep`;
      if (op.type === 'pocket') {
        return `Dado at ${fmtLen(op.x)}, ${fmtLen(op.y)} · ${fmtSize(op.length, op.width)} · ${fmtLen(op.depth)} deep`;
      }
      if (op.type === 'rabbet') {
        return `Rabbet on the back around the opening · ${fmtLen(op.lip)} wide × ${fmtLen(op.depth)} deep · ${fmtSize(op.length, op.width)} outside`;
      }
      if (op.type === 'opening') {
        return `Opening cut through at ${fmtLen(op.x)}, ${fmtLen(op.y)} · ${fmtSize(op.length, op.width)}`;
      }
      return null;
    })
    .filter(Boolean)
    .map((t) => h('p', {}, t));
  if (part.shaker) notes.unshift(h('p', {}, `Shaker frame · ${isImperial() ? fmtLen(part.shaker.frame) : `${Math.round(part.shaker.frame * 100) / 100} mm`} stiles and rails · inside corners take the CNC tool's radius`));
  if (part.cornerRadius) notes.push(h('p', {}, `Shaker center panel · corners R${fmtLenU(part.cornerRadius)} to fit the rabbet`));
  if (part.hinge?.cupCenter != null) {
    const hg = part.hinge;
    notes.push(h('p', {}, `Hinge cups at K ${fmtMm(hg.k)}: centres ${fmtMm(hg.cupCenter)} from the hinge edge · ${fmtMm(hg.plate)} mm plates`));
  }
  const header = `${part.name} — ${fmtSize(part.length, part.width)} × ${fmtMm(part.thickness)}${isImperial() ? ' mm' : ''}  ·  edges: ${edgeCode(part.edges) || 'none'}`;
  const legend = (color, label, square = false) =>
    h('span', {}, h('i', { style: { background: `var(${color})`, borderRadius: square ? '0' : null } }), label);

  const print = h('div', { class: 'add-row', style: { margin: '8px 0' } }, h('button', { class: 'primary', onclick: printDrawing }, 'Print drawing'));

  if (isSide(part)) {
    const c = effectiveConstruction(jobFor(state.project, state.selected), state.project.cabinets[state.selected]?.overrides);
    const opts = state.sideDrawing;
    mount(
      container,
      h(
        'div',
        { class: 'part-layout' },
        sideDrawing(cab, part, { ...opts, spacing: c.system.spacing }),
        h('div', { class: 'ops' }, h('strong', {}, cab.name), h('p', {}, header), print, notes, sideOps(cab, part, opts)),
      ),
    );
    return;
  }

  mount(
    container,
    h(
      'div',
      { class: 'part-layout' },
      drawing(part),
      h(
        'div',
        { class: 'ops' },
        h('strong', {}, cab.name),
        h('p', {}, header),
        print,
        h(
          'div',
          { class: 'legend' },
          legend('--bore-system', 'System'),
          legend('--bore-cup', 'Hinge cup'),
          legend('--bore-plate', 'Plate'),
          legend('--bore-slide', 'Slide'),
          legend('--band', 'Edge band', true),
        ),
        notes,
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Bore'), ['x', 'y', 'Ø'].map((t) => h('th', { class: 'num' }, isImperial() ? `${t} (mm)` : t)))),
          h(
            'tbody',
            {},
            bores(part).map((b) =>
              h(
                'tr',
                {},
                h('td', {}, PURPOSE_LABELS[b.purpose] ?? b.purpose),
                [b.x, b.y, b.diameter].map((v) => h('td', { class: 'num' }, fmtMm(v))),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
