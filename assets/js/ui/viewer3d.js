// WebGL2 viewer: every part is a box, drawn shaded with crisp edges.
// Drag to orbit, shift/right-drag to pan, wheel to zoom.

import { applianceSketch } from '../engine/appliance.js';
import { countertops } from '../engine/countertop.js';
import { effectiveConstruction, frontProjection, partStock } from '../engine/model.js';
import { isPlinth, partGroup } from '../engine/part.js';
import { cabinetPlacement, placedParts } from '../engine/project.js';
import { DEFAULT_WALL_COLOR, locations, placement } from '../engine/room.js';
import { solidcraftJson } from '../engine/solidcraft.js';
import { download, h } from './dom.js';
import { partKey, state } from './store.js';

const VERT = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec3 a_color;
uniform mat4 u_mvp;
out vec3 v_normal;
out vec3 v_color;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_normal = a_normal;
  v_color = a_color;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_color;
uniform float u_lit;
out vec4 o_color;
void main() {
  if (u_lit < 0.5) { o_color = vec4(v_color, 1.0); return; }
  vec3 n = normalize(v_normal);
  float key = max(dot(n, normalize(vec3(0.45, 0.8, 0.6))), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.6, 0.2, 0.4))), 0.0);
  o_color = vec4(v_color * (0.55 + 0.4 * key + 0.12 * fill), 1.0);
}`;

const FLOATS_PER_VERTEX = 9;
const SELECTED = [0.96, 0.55, 0.2];
const EDGE = [0.22, 0.24, 0.28];
// The selected cabinet: its parts tinted toward this, its edges drawn in it.
const HIGHLIGHT = [0.23, 0.51, 0.96];
const WALL_THICKNESS = 100;
// Appliance sketches: stainless, darker trim, black glass and cooktop, handles.
const APPLIANCE_TONES = { steel: [0.8, 0.81, 0.83], trim: [0.62, 0.64, 0.67], black: [0.1, 0.1, 0.11], handle: [0.5, 0.51, 0.54] };
const tint = (c, k = 0.4) => c.map((v, i) => v * (1 - k) + HIGHLIGHT[i] * k);

// ---- small vector / matrix helpers (column-major mat4) --------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => scale(a, 1 / (Math.hypot(...a) || 1));

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function lookAt(eye, target, up) {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  // prettier-ignore
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

// ---- camera ----------------------------------------------------------------

function defaultCamera() {
  return { yaw: -0.55, pitch: 0.32, dist: 4000, target: [1000, 1000, 300], fov: 0.7 };
}

function eyeOf(cam) {
  const cp = Math.cos(cam.pitch);
  return add(cam.target, scale([cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw)], cam.dist));
}

function fitCamera(cam, min, max) {
  cam.target = scale(add(min, max), 0.5);
  const radius = Math.max(100, Math.hypot(...sub(max, min)) / 2);
  cam.dist = (radius / Math.sin(cam.fov / 2)) * 1.05;
}

// ---- geometry ---------------------------------------------------------------

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return [0.6, 0.6, 0.6];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Material colour, shaded per role so same-material panels stay distinct. */
function partColor(c, part) {
  const base = hexRgb(partStock(c, part)?.color);
  const k = isPlinth(part.role) && part.material !== 'front' ? 0.55 : part.role === 'back' || part.role === 'drawerBottom' ? 0.88 : 1;
  return base.map((v) => v * k);
}

// (normal, four corners counter-clockwise seen from outside); corner bit 0 = x, 1 = y, 2 = z
const QUADS = [
  [[-1, 0, 0], [0, 4, 6, 2]],
  [[1, 0, 0], [1, 3, 7, 5]],
  [[0, -1, 0], [0, 1, 5, 4]],
  [[0, 1, 0], [2, 6, 7, 3]],
  [[0, 0, -1], [0, 2, 3, 1]],
  [[0, 0, 1], [4, 5, 7, 6]],
];
const BOX_EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];

function pushBox(faces, edges, min, size, color) {
  const max = add(min, size);
  const corner = (i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  for (const [n, q] of QUADS) {
    for (const i of [0, 1, 2, 0, 2, 3]) faces.push(...corner(q[i]), ...n, ...color);
  }
  for (const [a, b] of BOX_EDGES) {
    edges.push(...corner(a), 0, 0, 0, ...EDGE);
    edges.push(...corner(b), 0, 0, 0, ...EDGE);
  }
}

/**
 * A box with cuts (dadoes) removed. When every cut runs the full length of
 * one axis, the part is drawn as its cross-section extruded along that
 * axis, so outlines follow the real shape without seams. Otherwise it
 * falls back to the disjoint boxes left after subtraction.
 */
function pushPart(faces, edges, min, size, cuts, color) {
  if (!cuts?.length) {
    pushBox(faces, edges, min, size, color);
    return;
  }
  const eps = 1e-6;
  const max = add(min, size);
  const axis = [0, 1, 2].find((a) => cuts.every((c) => c.min[a] <= min[a] + eps && c.min[a] + c.size[a] >= max[a] - eps));
  if (axis === undefined) {
    pushCells(faces, edges, min, size, cuts, color);
    return;
  }
  const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
  // Grid of the cross-section from every boundary; a cell is solid unless a cut covers it.
  const lines = (k) =>
    [...new Set([min[k], max[k], ...cuts.flatMap((c) => [c.min[k], c.min[k] + c.size[k]])])]
      .filter((x) => x >= min[k] - eps && x <= max[k] + eps)
      .sort((a, b) => a - b);
  const us = lines(u);
  const vs = lines(v);
  const solid = us.slice(0, -1).map((u0, i) =>
    vs.slice(0, -1).map((v0, j) => {
      const cu = (u0 + us[i + 1]) / 2;
      const cv = (v0 + vs[j + 1]) / 2;
      return !cuts.some((c) => cu > c.min[u] && cu < c.min[u] + c.size[u] && cv > c.min[v] && cv < c.min[v] + c.size[v]);
    }),
  );
  const filled = (i, j) => i >= 0 && j >= 0 && i < solid.length && j < solid[0].length && solid[i][j];
  const point = (a, pu, pv) => {
    const p = [0, 0, 0];
    p[axis] = a;
    p[u] = pu;
    p[v] = pv;
    return p;
  };
  const normal = (k, sign) => {
    const n = [0, 0, 0];
    n[k] = sign;
    return n;
  };
  const quad = (corners, n) => {
    for (const i of [0, 1, 2, 0, 2, 3]) faces.push(...corners[i], ...n, ...color);
  };
  const line = (a, b) => edges.push(...a, 0, 0, 0, ...EDGE, ...b, 0, 0, 0, ...EDGE);
  const [a0, a1] = [min[axis], max[axis]];
  // Boundary segments of the cross-section, with the direction they run in.
  const boundary = [];
  for (let i = 0; i < solid.length; i++) {
    for (let j = 0; j < solid[i].length; j++) {
      if (!solid[i][j]) continue;
      const [u0, u1, v0, v1] = [us[i], us[i + 1], vs[j], vs[j + 1]];
      // End caps.
      quad([point(a0, u0, v0), point(a0, u1, v0), point(a0, u1, v1), point(a0, u0, v1)], normal(axis, -1));
      quad([point(a1, u0, v0), point(a1, u1, v0), point(a1, u1, v1), point(a1, u0, v1)], normal(axis, 1));
      // Long faces where the neighbouring cell is empty.
      const sides = [
        [!filled(i - 1, j), [u0, v0], [u0, v1], normal(u, -1), 'v'],
        [!filled(i + 1, j), [u1, v0], [u1, v1], normal(u, 1), 'v'],
        [!filled(i, j - 1), [u0, v0], [u1, v0], normal(v, -1), 'u'],
        [!filled(i, j + 1), [u0, v1], [u1, v1], normal(v, 1), 'u'],
      ];
      for (const [open, p, q, n, dir] of sides) {
        if (!open) continue;
        quad([point(a0, ...p), point(a1, ...p), point(a1, ...q), point(a0, ...q)], n);
        boundary.push({ p, q, dir });
      }
    }
  }
  // Outline at both ends, and a long edge at every corner of the profile.
  const corners = new Map();
  for (const { p, q, dir } of boundary) {
    line(point(a0, ...p), point(a0, ...q));
    line(point(a1, ...p), point(a1, ...q));
    for (const pt of [p, q]) {
      const key = pt.join(',');
      const dirs = corners.get(key) ?? new Set();
      dirs.add(dir);
      corners.set(key, dirs);
    }
  }
  for (const [key, dirs] of corners) {
    if (dirs.size < 2) continue;
    const [pu, pv] = key.split(',').map(Number);
    line(point(a0, pu, pv), point(a1, pu, pv));
  }
}

/**
 * A box with cuts in any direction (a shaker frame's opening and rabbet):
 * the box is split into a grid at every cut boundary, and only the faces
 * between solid and empty cells are drawn, with an edge only where the
 * surface folds, so the part shows no seams between grid cells.
 */
function pushCells(faces, edges, min, size, cuts, color) {
  const eps = 1e-6;
  const max = add(min, size);
  const grid = [0, 1, 2].map((k) =>
    [...new Set([min[k], max[k], ...cuts.flatMap((c) => [c.min[k], c.min[k] + c.size[k]])])]
      .filter((x) => x >= min[k] - eps && x <= max[k] + eps)
      .sort((a, b) => a - b),
  );
  const n = grid.map((g) => g.length - 1);
  const mid = (k, i) => (grid[k][i] + grid[k][i + 1]) / 2;
  const solid = [];
  for (let i = 0; i < n[0]; i++) {
    for (let j = 0; j < n[1]; j++) {
      for (let l = 0; l < n[2]; l++) {
        const c = [mid(0, i), mid(1, j), mid(2, l)];
        solid[(i * n[1] + j) * n[2] + l] = !cuts.some((cut) => [0, 1, 2].every((k) => c[k] > cut.min[k] && c[k] < cut.min[k] + cut.size[k]));
      }
    }
  }
  const filled = ([i, j, l]) => i >= 0 && j >= 0 && l >= 0 && i < n[0] && j < n[1] && l < n[2] && solid[(i * n[1] + j) * n[2] + l];
  for (let i = 0; i < n[0]; i++) {
    for (let j = 0; j < n[1]; j++) {
      for (let l = 0; l < n[2]; l++) {
        if (!filled([i, j, l])) continue;
        const lo = [grid[0][i], grid[1][j], grid[2][l]];
        const hi = [grid[0][i + 1], grid[1][j + 1], grid[2][l + 1]];
        const corner = (b) => [b & 1 ? hi[0] : lo[0], b & 2 ? hi[1] : lo[1], b & 4 ? hi[2] : lo[2]];
        for (const [nrm, q] of QUADS) {
          if (filled([i + nrm[0], j + nrm[1], l + nrm[2]])) continue;
          for (const b of [0, 1, 2, 0, 2, 3]) faces.push(...corner(q[b]), ...nrm, ...color);
        }
      }
    }
  }
  // An edge along axis k where the four cells around it don't make a flat face.
  for (let k = 0; k < 3; k++) {
    const [u, v] = [(k + 1) % 3, (k + 2) % 3];
    for (let a = 0; a <= n[u]; a++) {
      for (let b = 0; b <= n[v]; b++) {
        for (let c = 0; c < n[k]; c++) {
          const at = (du, dv) => {
            const idx = [0, 0, 0];
            idx[k] = c;
            idx[u] = a + du;
            idx[v] = b + dv;
            return filled(idx);
          };
          const [s00, s10, s01, s11] = [at(-1, -1), at(0, -1), at(-1, 0), at(0, 0)];
          const count = s00 + s10 + s01 + s11;
          if (count === 0 || count === 4 || (count === 2 && s00 !== s11)) continue;
          const p = [0, 0, 0];
          p[u] = grid[u][a];
          p[v] = grid[v][b];
          p[k] = grid[k][c];
          const q = [...p];
          q[k] = grid[k][c + 1];
          edges.push(...p, 0, 0, 0, ...EDGE, ...q, 0, 0, 0, ...EDGE);
        }
      }
    }
  }
}

/** Triangles covering a simple polygon ([x, z] corners, either winding): ear clipping. */
function triangulate(poly) {
  const ccw = poly.reduce((a, p, i) => a + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0) > 0;
  const idx = poly.map((_, i) => i);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => [cross(a, b, p), cross(b, c, p), cross(c, a, p)].every((v) => (ccw ? v > 1e-9 : v < -1e-9));
  const tris = [];
  while (idx.length > 3) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const [i, j, l] = [idx[(k + idx.length - 1) % idx.length], idx[k], idx[(k + 1) % idx.length]];
      const [a, b, c] = [poly[i], poly[j], poly[l]];
      const convex = ccw ? cross(a, b, c) > 1e-9 : cross(a, b, c) < -1e-9;
      if (!convex || idx.some((m) => m !== i && m !== j && m !== l && inside(poly[m], a, b, c))) continue;
      tris.push([i, j, l]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break; // degenerate: give up on the rest
  }
  if (idx.length === 3) tris.push(idx);
  return tris;
}

/** A flat panel on a plan outline ([x, z] corners), from y0 to y1. */
function pushPrism(faces, edges, plan, y0, y1, color) {
  const n = plan.length;
  const ccw = plan.reduce((a, p, i) => a + p[0] * plan[(i + 1) % n][1] - plan[(i + 1) % n][0] * p[1], 0) > 0;
  const at = ([x, z], y) => [x, y, z];
  for (const tri of triangulate(plan)) {
    // Seen from above (-y) a counter-clockwise outline in x/z is clockwise: wind each cap outward.
    const up = ccw ? [...tri].reverse() : tri;
    for (const i of up) faces.push(...at(plan[i], y1), 0, 1, 0, ...color);
    for (const i of [...up].reverse()) faces.push(...at(plan[i], y0), 0, -1, 0, ...color);
  }
  for (let i = 0; i < n; i++) {
    const [a, b] = [plan[i], plan[(i + 1) % n]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const out = ccw ? [(b[1] - a[1]) / len, 0, -(b[0] - a[0]) / len] : [-(b[1] - a[1]) / len, 0, (b[0] - a[0]) / len];
    const quad = [at(a, y0), at(b, y0), at(b, y1), at(a, y1)];
    for (const k of [0, 1, 2, 0, 2, 3]) faces.push(...quad[k], ...out, ...color);
    for (const [p, q] of [
      [at(a, y0), at(b, y0)],
      [at(a, y1), at(b, y1)],
      [at(a, y0), at(a, y1)],
    ]) {
      edges.push(...p, 0, 0, 0, ...EDGE, ...q, 0, 0, 0, ...EDGE);
    }
  }
}

/**
 * Geometry drawn by `draw(faces, edges)` in a part's own space, mapped into
 * world space by `map` (point and direction), so turned parts (walls at
 * 90°, a corner cabinet's 45° door) need no geometry of their own.
 */
function pushMapped(faces, edges, map, draw, edgeColor = null) {
  const [f, e] = [[], []];
  draw(f, e);
  for (const [src, dst, normals] of [
    [f, faces, true],
    [e, edges, false],
  ]) {
    for (let i = 0; i < src.length; i += FLOATS_PER_VERTEX) {
      const color = !normals && edgeColor ? edgeColor : src.slice(i + 6, i + 9);
      dst.push(...map.point(src.slice(i, i + 3)), ...(normals ? map.dir(src.slice(i + 3, i + 6)) : [0, 0, 0]), ...color);
    }
  }
}

// ---- renderer ---------------------------------------------------------------

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function makeMesh(gl) {
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const stride = FLOATS_PER_VERTEX * 4;
  [0, 12, 24].forEach((offset, loc) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, stride, offset);
  });
  gl.bindVertexArray(null);
  return { vao, vbo, count: 0 };
}

/** Downloads the whole job (whatever the view hides) as a .solidcraft design. */
function exportSolidCraft() {
  download(`${state.project.name || 'Cabinets'}.solidcraft`, 'application/json', solidcraftJson(state.project, state.built));
}

export class Viewer3D {
  constructor() {
    this.canvas = h('canvas', {});
    this.camera = defaultCamera();
    this.bounds = null;
    this.drawn = null; // what the current geometry was built from
    this.element = h(
      'div',
      { style: { position: 'absolute', inset: '0' } },
      this.canvas,
      h(
        'div',
        { class: 'view-tools' },
        h(
          'button',
          { title: 'Download the job as a SolidCraft design: every part with its dadoes and drilling', onclick: exportSolidCraft },
          'Export 3D SolidCraft',
        ),
        h('button', { onclick: () => this.fit() }, 'Fit view'),
      ),
      h('div', { class: 'hint' }, 'Drag to orbit · Shift/right-drag to pan · Scroll to zoom · Click a part row to highlight'),
    );
    try {
      this.init();
    } catch (e) {
      this.gl = null;
      this.element.append(h('div', { class: 'error', style: { position: 'absolute', top: '10px', left: '10px' } }, e.message));
    }
  }

  init() {
    const gl = this.canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    this.program = program;
    this.uMvp = gl.getUniformLocation(program, 'u_mvp');
    this.uLit = gl.getUniformLocation(program, 'u_lit');
    this.faces = makeMesh(gl);
    this.edges = makeMesh(gl);

    // Redraw whenever the canvas changes size (window resize, tab shown).
    new ResizeObserver(() => this.draw()).observe(this.canvas);

    let drag = null;
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const [dx, dy] = [e.clientX - drag.x, e.clientY - drag.y];
      [drag.x, drag.y] = [e.clientX, e.clientY];
      if (drag.pan) this.pan(dx, dy);
      else {
        this.camera.yaw -= dx * 0.008;
        this.camera.pitch = Math.min(1.45, Math.max(-1.45, this.camera.pitch + dy * 0.008));
      }
      this.draw();
    });
    const end = () => (drag = null);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camera.dist = Math.min(50000, Math.max(200, this.camera.dist * (1 + e.deltaY * 0.001)));
        this.draw();
      },
      { passive: false },
    );
  }

  pan(dx, dy) {
    const cam = this.camera;
    const forward = normalize(sub(cam.target, eyeOf(cam)));
    const right = normalize(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const k = (2 * cam.dist * Math.tan(cam.fov / 2)) / Math.max(1, this.canvas.clientHeight);
    cam.target = add(cam.target, scale(add(scale(right, -dx), scale(up, dy)), k));
  }

  fit() {
    if (!this.bounds) return;
    this.camera = { ...defaultCamera() };
    fitCamera(this.camera, ...this.bounds);
    this.draw();
  }

  /** Rebuilds geometry when the job, selection or visibility changed. */
  update() {
    if (!this.gl) return;
    const key = `${state.version}|${state.selected}|${state.selectedPart}|${state.visibilityVersion}`;
    if (key !== this.drawn) {
      this.drawn = key;
      this.rebuild();
    }
    this.draw();
  }

  rebuild() {
    const { project, built, selected, selectedPart, hiddenGroups, hiddenParts } = state;
    // Showing the selected cabinet on its own needs one selected.
    const isolate = state.isolate && !!project.cabinets[selected];
    const faces = [];
    const edges = [];
    let bounds = null;
    for (const pp of placedParts(project, built)) {
      if (isolate && pp.cabinet !== selected) continue;
      if (hiddenGroups.has(partGroup(pp.part.role))) continue;
      if (hiddenParts.has(partKey(project.cabinets[pp.cabinet], pp.index))) continue;
      const isSelected = pp.cabinet === selected && pp.index === selectedPart;
      // The selected cabinet stands out (unless it is shown on its own).
      const inSelected = pp.cabinet === selected && !isolate;
      const base = partColor(project.construction, pp.part);
      const color = isSelected ? SELECTED : inSelected ? tint(base) : base;
      const { bbox, cuts, plan } = pp.part;
      pushMapped(
        faces,
        edges,
        pp.map,
        (f, e) => (plan ? pushPrism(f, e, plan, bbox.min[1], bbox.min[1] + bbox.size[1], color) : pushPart(f, e, bbox.min, bbox.size, cuts, color)),
        inSelected ? HIGHLIGHT : null,
      );
      const hi = add(pp.min, pp.size);
      bounds = bounds
        ? [bounds[0].map((v, i) => Math.min(v, pp.min[i])), bounds[1].map((v, i) => Math.max(v, hi[i]))]
        : [pp.min, hi];
    }
    // Spaces (room left for an appliance): a sketch of the dishwasher, range
    // or fridge, and an outline of the space when it is a plain one or selected.
    const ct = project.construction.countertop;
    project.cabinets.forEach((spec, i) => {
      if (spec.kind !== 'space' || (isolate && i !== selected)) return;
      const map = cabinetPlacement(project, spec);
      const color = i === selected ? HIGHLIGHT : EDGE;
      const c = effectiveConstruction(project.construction, spec.overrides);
      const sketch = hiddenGroups.has('appliances') ? [] : applianceSketch(spec, { ft: frontProjection(c), top: ct?.enabled === false ? 0 : (ct?.thickness ?? 0) });
      for (const b of sketch) {
        const tone = APPLIANCE_TONES[b.tone];
        pushMapped(faces, edges, map, (f, e) => pushBox(f, e, b.min, b.size, i === selected ? tint(tone) : tone), i === selected ? HIGHLIGHT : null);
      }
      if (!sketch.length || i === selected) pushMapped([], edges, map, (f, e) => pushBox(f, e, [0, 0, 0], [spec.width, spec.height, spec.depth], color), color);
    });
    // The room's walls: a slab behind each wall line, up to the ceiling; an
    // inside corner is closed by running the wall on past its end.
    if (!isolate && !hiddenGroups.has('walls')) {
      const locs = locations(project).filter((l) => l.kind === 'wall');
      const height = project.room?.height ?? 2400;
      const color = hexRgb(project.room?.wallColor ?? DEFAULT_WALL_COLOR);
      locs.forEach((l, k) => {
        const past = locs[k + 1]?.wall.turn === 'inside' ? WALL_THICKNESS : 0;
        const map = placement(l, { x: 0, elevation: 0 });
        pushMapped(faces, edges, map, (f, e) => pushBox(f, e, [0, 0, -WALL_THICKNESS], [l.length + past, height, WALL_THICKNESS], color));
      });
    }
    // Countertops over the base runs (not parts, so never selected).
    if (!isolate && !hiddenGroups.has('countertop')) {
      const color = hexRgb(project.construction.countertop.color);
      for (const top of countertops(project, built)) {
        pushMapped(faces, edges, top.map, (f, e) => pushBox(f, e, [top.x0, top.y, top.z0], [top.length, top.thickness, top.depth], color));
      }
    }
    const gl = this.gl;
    for (const [mesh, data] of [
      [this.faces, faces],
      [this.edges, edges],
    ]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
      mesh.count = data.length / FLOATS_PER_VERTEX;
    }
    // Frame the job the first time there is something to show.
    if (!this.bounds && bounds) fitCamera(this.camera, ...bounds);
    this.bounds = bounds;
  }

  draw() {
    const gl = this.gl;
    if (!gl) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const hgt = Math.round(this.canvas.clientHeight * dpr);
    if (!w || !hgt) return; // hidden tab
    if (this.canvas.width !== w || this.canvas.height !== hgt) {
      this.canvas.width = w;
      this.canvas.height = hgt;
    }
    gl.viewport(0, 0, w, hgt);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    const cam = this.camera;
    const mvp = multiply(
      perspective(cam.fov, w / hgt, cam.dist * 0.01, cam.dist * 20),
      lookAt(eyeOf(cam), cam.target, [0, 1, 0]),
    );
    gl.uniformMatrix4fv(this.uMvp, false, mvp);

    // Push faces back slightly so edge lines win the depth test.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.uniform1f(this.uLit, 1);
    gl.bindVertexArray(this.faces.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.faces.count);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    gl.uniform1f(this.uLit, 0);
    gl.bindVertexArray(this.edges.vao);
    gl.drawArrays(gl.LINES, 0, this.edges.count);
    gl.bindVertexArray(null);
  }
}
