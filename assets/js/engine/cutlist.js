// Aggregates the parts of a job into a cut list grouped by identical parts.

import { bandThickness, materialById, partMaterial } from './model.js';
import { cutSize, edgeCode } from './part.js';
import { csvLen, unitName } from './units.js';

/** Rounds to 0.1 mm so float noise doesn't split identical parts. */
const keyMm = (v) => Math.round(v * 10);

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @returns {{ rows: object[], materials: object[], bands: object[], edgeBandM: number }}
 *   bands: length of each edge band needed, [{ id, name, type, thickness, color, m }].
 */
export function cutList(cabinets, c) {
  const groups = new Map();
  const totals = new Map();
  const bandTotals = new Map();
  let edgeBandMm = 0;

  for (const cab of cabinets) {
    for (const part of cab.parts) {
      const mat = partMaterial(c, part);
      if (!mat) continue;
      const [cutLength, cutWidth] = cutSize(part, bandThickness(c, part));
      const edges = edgeCode(part.edges);
      const band = edges ? materialById(c, part.bandId) : null;
      const sortKey = [mat.id, part.name, keyMm(part.length), keyMm(part.width), edges, band?.id ?? 0];
      const key = sortKey.join('|');
      let row = groups.get(key);
      if (!row) {
        row = {
          sortKey,
          qty: 0,
          name: part.name,
          material: mat.name,
          thickness: part.thickness,
          length: part.length,
          width: part.width,
          cutLength,
          cutWidth,
          edges,
          band: band?.name ?? '',
          cabinets: [],
        };
        groups.set(key, row);
      }
      row.qty += 1;
      if (!row.cabinets.includes(cab.name)) row.cabinets.push(cab.name);

      let total = totals.get(mat.id);
      if (!total) {
        total = { id: mat.id, material: mat.name, thickness: mat.thickness, parts: 0, areaM2: 0 };
        totals.set(mat.id, total);
      }
      total.parts += 1;
      total.areaM2 += (cutLength * cutWidth) / 1e6;

      const e = part.edges;
      const bandMm = part.length * (e.l1 + e.l2) + part.width * (e.w1 + e.w2);
      edgeBandMm += bandMm;
      if (bandMm > 0) {
        const id = band?.id ?? 0;
        if (!bandTotals.has(id)) {
          bandTotals.set(id, {
            id,
            name: band?.name ?? 'Edge band',
            type: band?.bandType ?? '',
            thickness: bandThickness(c, part),
            color: band?.color ?? null,
            m: 0,
          });
        }
        bandTotals.get(id).m += bandMm / 1000;
      }
    }
  }

  const rows = [...groups.values()].sort((a, b) => {
    for (let i = 0; i < a.sortKey.length; i++) {
      const d = compare(a.sortKey[i], b.sortKey[i]);
      if (d) return d;
    }
    return 0;
  });
  rows.forEach((r) => delete r.sortKey);
  return {
    rows,
    materials: [...totals.values()].sort((a, b) => a.id - b.id),
    bands: [...bandTotals.values()].sort((a, b) => a.id - b.id),
    edgeBandM: edgeBandMm / 1000,
  };
}

/** The cut list as CSV: lengths in mm, or (units 'in') decimal inches with the
 *  unit in the headers. Thickness stays in mm. */
export function cutListCsv(list, { units = unitName() } = {}) {
  const esc = (s) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  const len = (v) => csvLen(v, units);
  const lines = [
    units === 'in'
      ? 'Qty,Part,Material,Thickness (mm),Length (in),Width (in),Cut length (in),Cut width (in),Edge banding,Edge band,Cabinets'
      : 'Qty,Part,Material,Thickness,Length,Width,Cut length,Cut width,Edge banding,Edge band,Cabinets',
  ];
  for (const r of list.rows) {
    lines.push(
      [
        r.qty,
        esc(r.name),
        esc(r.material),
        r.thickness,
        len(r.length),
        len(r.width),
        len(r.cutLength),
        len(r.cutWidth),
        esc(r.edges),
        esc(r.band),
        esc(r.cabinets.join('; ')),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}
