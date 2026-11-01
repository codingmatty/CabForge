// Front elevation of one wall or island (the current one, picked above the
// drawing), drawn from the built parts.

import { effectiveConstruction, material, partMaterial, toeHeight } from '../engine/model.js';
import { bores, isFront } from '../engine/part.js';
import { atOf, cabinetPlacement, jobFor, partMap, standOff } from '../engine/project.js';
import { locationById, locations, toLocation } from '../engine/room.js';
import { h, mount, s } from './dom.js';
import { currentAt, setState, state, toggleSelect } from './store.js';
import { fmtLen } from '../engine/units.js';

export function renderElevation(container) {
  const { project, built, selected } = state;
  const showFronts = !state.hiddenGroups.has('fronts');
  const job = project.construction;
  const here = currentAt();
  const loc = locationById(project, here);
  // Only this wall's cabinets, keeping their indexes for selection.
  const at = project.cabinets.map((spec, i) => [spec, i]).filter(([spec]) => atOf(project, spec) === here);
  const cabs = at.map(([spec]) => spec);
  const xMax = Math.max(1000, loc.kind === 'wall' ? loc.length : 0, ...cabs.map((s) => s.x + s.width));
  const xMin = Math.min(0, ...cabs.map((s) => s.x));
  const top = Math.max(1000, ...cabs.map((s) => s.elevation + s.height));
  const margin = 150;
  const font = Math.max(24, Math.max(xMax - xMin, top) * 0.026);
  const y = (v) => top - v; // SVG y grows downward

  const cabinets = at.map(([spec, i]) => {
    // Each cabinet may override the job construction.
    const c = effectiveConstruction(jobFor(project, i), spec.overrides);
    const caseFill = material(c, 'case')?.color;
    const toe = toeHeight(c, spec);
    const [x0, w] = [spec.x, spec.width];
    const [caseY0, caseY1] = [spec.elevation + toe, spec.elevation + spec.height];
    const shapes = [];
    // A space: its outline and name, for the appliance that goes there.
    if (spec.kind === 'space') {
      const box = s('rect', { class: i === selected ? 'el-space selected' : 'el-space', x: x0, y: y(caseY1), width: w, height: spec.height });
      const mid = y(spec.elevation + spec.height / 2);
      const text = (t, dy) => s('text', { class: 'dw-muted', x: x0 + w / 2, y: mid + dy, 'font-size': font * 0.7, 'text-anchor': 'middle' }, t);
      return s('g', { class: 'cab-hit', onclick: () => toggleSelect(i) }, box, text(spec.name, 0), text(fmtLen(w), font * 0.9));
    }
    if (toe > 0) shapes.push(s('rect', { class: 'dw-groove', x: x0, y: y(spec.elevation + toe), width: w, height: toe }));
    shapes.push(
      s('rect', {
        class: i === selected ? 'dw-case selected' : 'dw-case',
        style: caseFill ? { fill: caseFill } : null,
        x: x0,
        y: y(caseY1),
        width: w,
        height: caseY1 - caseY0,
      }),
    );

    const cab = built[i]?.cabinet;
    // Fillers: the strip itself, drawn in its material over the case outline.
    for (const p of cab && !state.hiddenGroups.has('fillers') ? cab.parts.filter((p) => p.role === 'filler') : []) {
      const fill = partMaterial(job, p)?.color;
      const fy = spec.elevation + p.bbox.min[1];
      shapes.push(
        s('rect', { class: 'dw-front', style: fill ? { fill } : null, x: x0, y: y(fy + p.bbox.size[1]), width: p.bbox.size[0], height: p.bbox.size[1] }),
      );
    }
    // End panels, drawn beside the case down to the bottom of the floor scribe.
    for (const p of cab && !state.hiddenGroups.has('endPanels') ? cab.parts.filter((p) => p.role === 'endPanel') : []) {
      const fill = partMaterial(job, p)?.color;
      const [py0, ph] = [spec.elevation + p.bbox.min[1], p.bbox.size[1]];
      shapes.push(
        s('rect', { class: 'dw-front', style: fill ? { fill } : null, x: x0 + p.bbox.min[0], y: y(py0 + ph), width: p.bbox.size[0], height: ph }),
      );
    }
    if (cab && showFronts) {
      // Turned fronts (a corner's return or diagonal door) are drawn with the corners below.
      for (const p of cab.parts.filter((p) => isFront(p.role) && !p.frame)) {
        const fx = x0 + p.bbox.min[0];
        const fy = spec.elevation + p.bbox.min[1];
        const [fw, fh] = [p.bbox.size[0], p.bbox.size[1]];
        const frontFill = partMaterial(job, p)?.color;
        shapes.push(
          s('rect', { class: 'dw-front', style: frontFill ? { fill: frontFill } : null, x: fx, y: y(fy + fh), width: fw, height: fh }),
        );
        // A shaker front's frame around its panel.
        const f = p.shaker?.frame;
        if (f) shapes.push(s('rect', { class: 'dw-front', style: frontFill ? { fill: frontFill } : null, x: fx + f, y: y(fy + fh - f), width: fw - 2 * f, height: fh - 2 * f }));
        if (p.role === 'door') {
          // Swing lines meet at the hinge side.
          const cup = bores(p).find((b) => b.purpose === 'hingeCup');
          const hingeLeft = !cup || cup.y < p.width / 2;
          const [hx, ox] = hingeLeft ? [fx, fx + fw] : [fx + fw, fx];
          shapes.push(s('path', { class: 'dw-swing', d: `M${ox},${y(fy + fh)} L${hx},${y(fy + fh / 2)} L${ox},${y(fy)}` }));
        } else {
          const hy = y(fy + fh - Math.min(fh * 0.25, 60));
          shapes.push(s('path', { class: 'dw-line', d: `M${fx + fw * 0.35},${hy} L${fx + fw * 0.65},${hy}` }));
        }
      }
    }

    // Label below lower cabinets, above upper ones.
    const labelY = spec.elevation > 0 ? y(caseY1) - font * 0.6 : y(0) + font * 1.4;
    return s(
      'g',
      { class: 'cab-hit', onclick: () => toggleSelect(i) },
      shapes,
      s('text', { class: 'dw-text', x: x0 + w / 2, y: labelY, 'font-size': font * 0.8, 'text-anchor': 'middle' }, spec.kind === 'filler' ? fmtLen(w) : `${spec.name}  ·  ${fmtLen(w)}`),
    );
  });

  // Corner cabinets: the turned fronts of those at this wall (a diagonal
  // door), and the return of those at the wall before, seen from here.
  const prev = loc.kind === 'wall' ? locations(project)[loc.index - 1] : null;
  const corners = project.cabinets.flatMap((spec, i) => {
    const cab = built[i]?.cabinet;
    if (!spec.corner || !cab) return [];
    const mine = atOf(project, spec) === here;
    const returns = prev && loc.wall.turn === 'inside' && atOf(project, spec) === prev.id;
    if (!mine && !returns) return [];
    const place = cabinetPlacement(project, spec);
    const off = standOff(project, spec);
    const shapes = [];
    if (returns) {
      const c = effectiveConstruction(jobFor(project, i), spec.overrides);
      const toe = toeHeight(c, spec);
      if (toe > 0) shapes.push(s('rect', { class: 'dw-groove', x: off, y: y(spec.elevation + toe), width: spec.corner.return, height: toe }));
      shapes.push(s('rect', { class: i === selected ? 'dw-case selected' : 'dw-case', x: off, y: y(spec.elevation + spec.height), width: spec.corner.return, height: spec.height - toe }));
    }
    for (const p of showFronts ? cab.parts.filter((p) => isFront(p.role) && (returns || p.frame)) : []) {
      const map = partMap(p, place);
      // Only fronts that face this way.
      const out = map.dir([0, 0, 1]);
      if (out[0] * loc.n[0] + out[2] * loc.n[1] < 0.5) continue;
      const b = p.bbox;
      const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => toLocation(loc, map.point([0, 1, 2].map((a) => b.min[a] + ((k >> a) & 1 ? b.size[a] : 0)))));
      const [s0, s1] = [Math.min(...pts.map((q) => q.s)), Math.max(...pts.map((q) => q.s))];
      const [fy0, fy1] = [Math.min(...pts.map((q) => q.y)), Math.max(...pts.map((q) => q.y))];
      const fill = partMaterial(job, p)?.color;
      shapes.push(s('rect', { class: 'dw-front', style: fill ? { fill } : null, x: s0, y: y(fy1), width: s1 - s0, height: fy1 - fy0 }));
    }
    return shapes.length ? [s('g', { class: 'cab-hit', onclick: () => toggleSelect(i) }, shapes)] : [];
  });

  // The wall itself, as far as it goes.
  const wall = loc.kind === 'wall' ? s('rect', { class: 'el-wall', x: 0, y: y(top), width: loc.length, height: top }) : null;
  mount(
    container,
    h(
      'div',
      { class: 'elev-layout' },
      h(
        'nav',
        { class: 'tabs elev-tabs', 'aria-label': 'Wall or island' },
        locations(project).map((l) => h('button', { class: l.id === here ? 'active' : null, onclick: () => setState({ at: l.id }) }, l.name)),
      ),
      s(
        'svg',
        {
          viewBox: `${xMin - margin} ${-margin} ${xMax - xMin + 2 * margin} ${top + 2 * margin + font * 2}`,
          preserveAspectRatio: 'xMidYMid meet',
        },
        wall,
        s('line', { class: 'dw-line', x1: xMin - margin, y1: y(0), x2: xMax + margin, y2: y(0) }),
        cabinets,
        corners,
      ),
    ),
  );
}
