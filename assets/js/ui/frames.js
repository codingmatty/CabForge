// Face frames view: an assembly drawing of each face frame in the job (see
// project.js faceFrames), seen from the front: where every stile and rail
// goes, the openings between them and their sizes.

import { JOINERY, effectiveConstruction } from '../engine/model.js';
import { faceFrames, jobFor } from '../engine/project.js';
import { locationById } from '../engine/room.js';
import { h, mount, s } from './dom.js';
import { state } from './store.js';
import { fmtLen, fmtLenU, fmtSize } from '../engine/units.js';

/** Whether any cabinet in the job has a face frame. */
export function hasFaceFrames(built) {
  return built.some((b) => b.cabinet?.frame);
}

function printFrames() {
  document.body.classList.add('print-frames');
  window.addEventListener('afterprint', () => document.body.classList.remove('print-frames'), { once: true });
  window.print();
}

/** One frame's drawing: stiles and rails, opening sizes, stile widths below
 *  and the overall size. */
function frameDrawing(fr) {
  const x0 = Math.min(...fr.stiles.map((st) => st.x0));
  const x1 = Math.max(...fr.stiles.map((st) => st.x1));
  const [w, ht] = [x1 - x0, fr.top - fr.bottom];
  const font = Math.max(14, Math.max(w, ht) * 0.022);
  const margin = font * 5;
  const X = (x) => x - x0;
  const Y = (y) => fr.top - y;
  const fill = fr.wood?.color ?? '#e8d2a6';
  const piece = (x, y, pw, ph) => s('rect', { class: 'dw-part', style: { fill }, x, y, width: pw, height: ph });
  const text = (x, y, t, cls = 'dw-text', size = font) => s('text', { class: cls, x, y, 'font-size': size, 'text-anchor': 'middle' }, t);
  return s(
    'svg',
    { class: 'frame-drawing', viewBox: `${-margin} ${-margin} ${w + 2 * margin} ${ht + 2 * margin + font * 2}`, preserveAspectRatio: 'xMidYMid meet' },
    fr.stiles.map((st) => piece(X(st.x0), 0, st.x1 - st.x0, ht)),
    fr.rails.map((r) => piece(X(r.x0), Y(r.y1), r.x1 - r.x0, r.y1 - r.y0)),
    fr.openings.map((o) => [
      text(X((o.x0 + o.x1) / 2), Y((o.y0 + o.y1) / 2), fmtSize(o.x1 - o.x0, o.y1 - o.y0)),
      text(X((o.x0 + o.x1) / 2), Y((o.y0 + o.y1) / 2) + font * 1.3, 'opening', 'dw-muted', font * 0.75),
    ]),
    // Stile widths under the frame, rail widths beside the first opening.
    fr.stiles.map((st) => text(X((st.x0 + st.x1) / 2), ht + font * 1.6, fmtLen(st.x1 - st.x0), 'dw-muted', font * 0.8)),
    fr.rails
      .filter((r) => r.owner === fr.cabinets[0])
      .map((r) => text(X(r.x0) + font * 2.5, Y((r.y0 + r.y1) / 2) + font * 0.3, fmtLen(r.y1 - r.y0), 'dw-muted', font * 0.7)),
    s('line', { class: 'dw-dim', x1: 0, y1: -margin * 0.4, x2: w, y2: -margin * 0.4 }),
    text(w / 2, -margin * 0.5, fmtLen(w)),
    s('line', { class: 'dw-dim', x1: -margin * 0.4, y1: 0, x2: -margin * 0.4, y2: ht }),
    s('text', { class: 'dw-text', x: -margin * 0.5, y: ht / 2, 'font-size': font, 'text-anchor': 'middle', transform: `rotate(-90 ${-margin * 0.5} ${ht / 2})` }, fmtLen(ht)),
  );
}

export function renderFrames(container) {
  const { project, built } = state;
  const frames = faceFrames(project, built);
  if (!frames.length) {
    mount(container, h('p', { class: 'hint' }, 'No face frames in this job. Settings → Cabinet style picks a face-frame style for the job; a cabinet can pick its own (its ⚙ → Style & frame).'));
    return;
  }
  mount(
    container,
    h('div', { class: 'add-row supply-actions' }, h('button', { class: 'primary', onclick: printFrames }, 'Print')),
    frames.map((fr, k) => {
      const names = fr.cabinets.map((i) => project.cabinets[i].name);
      const c = effectiveConstruction(jobFor(project, fr.cabinets[0]), project.cabinets[fr.cabinets[0]].overrides);
      const ff = c.faceFrame;
      const joint = JOINERY[ff.joinery] + (ff.joinery === 'mortise' ? `, ${fmtLenU(ff.tenon)} tenons` : ff.joinery === 'dowel' ? `, ${ff.dowels} per joint` : '');
      return h(
        'section',
        { class: 'frame-card' },
        h('h3', {}, `Frame ${k + 1} · ${locationById(project, fr.at)?.name ?? ''} · ${names.join(', ')}`),
        h(
          'p',
          { class: 'muted' },
          `${fr.wood?.name ?? 'Solid wood'} ${fmtLenU(fr.thickness)} · ${fr.stiles.length} stiles, ${fr.rails.length} rails · ${joint}. ` +
            'Stiles run the full height; rails go between them. Openings are between the stiles and rails.',
        ),
        frameDrawing(fr),
      );
    }),
  );
}
