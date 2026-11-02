// Aggregates the parts of a job into a cut list grouped by identical parts.

import { JOINERY, bandThickness, materialById, partMaterial, partStock } from './model.js';
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
  const solid = solidCutList(cabinets, c);
  return {
    rows,
    solid: solid.rows,
    woods: solid.woods,
    materials: [...totals.values()].sort((a, b) => a.id - b.id),
    bands: [...bandTotals.values()].sort((a, b) => a.id - b.id),
    edgeBandM: edgeBandMm / 1000,
  };
}

const MM_PER_IN = 25.4;

/** A joint's description for the cut list: "Pocket screws", "Mortise &
 *  tenon, 1″ tenons", "Dowels / dominos, 2 per joint". */
export function jointLabel(j) {
  if (!j) return '';
  const name = JOINERY[j.type] ?? j.type;
  if (j.type === 'mortise' && j.tenon) return `${name}, ${+(j.tenon / MM_PER_IN).toFixed(3)}″ tenons`;
  if (j.type === 'dowel' && j.dowels) return `${name}, ${j.dowels} per joint`;
  return name;
}

/**
 * Face frame stiles and rails (solid wood, not nested on sheets), grouped
 * like the sheet parts, and the wood each species takes: board feet of
 * rough stock (length × width × its quarters, plus the waste allowance) and
 * what that costs at the price per board foot.
 * @returns {{ rows: object[], woods: { id, name, quarters, parts, lengthMm, boardFeet, unitCost, cost }[] }}
 */
export function solidCutList(cabinets, c) {
  const groups = new Map();
  const woods = new Map();
  for (const cab of cabinets) {
    for (const part of cab.parts) {
      if (!part.solid) continue;
      const wood = partStock(c, part);
      const joints = jointLabel(part.joint);
      const key = [wood?.id ?? 0, part.name, keyMm(part.length), keyMm(part.width), keyMm(part.thickness), joints].join('|');
      if (!groups.has(key)) {
        groups.set(key, { qty: 0, name: part.name, wood: wood?.name ?? 'Solid wood', thickness: part.thickness, length: part.length, width: part.width, joinery: joints, cabinets: [], woodId: wood?.id ?? 0 });
      }
      const row = groups.get(key);
      row.qty += 1;
      if (!row.cabinets.includes(cab.name)) row.cabinets.push(cab.name);
      const id = wood?.id ?? 0;
      if (!woods.has(id)) {
        woods.set(id, { id, name: wood?.name ?? 'Solid wood', quarters: wood?.quarters || 4, waste: wood?.waste ?? 0, parts: 0, lengthMm: 0, boardFeet: 0, unitCost: wood?.cost || 0, cost: 0 });
      }
      const w = woods.get(id);
      w.parts += 1;
      w.lengthMm += part.length;
      // Board feet: inches long × wide × thick (rough, in quarters) / 144.
      w.boardFeet += ((part.length / MM_PER_IN) * (part.width / MM_PER_IN) * (w.quarters / 4)) / 144;
    }
  }
  for (const w of woods.values()) {
    w.boardFeet *= 1 + (w.waste || 0) / 100;
    w.cost = w.boardFeet * w.unitCost;
  }
  const rows = [...groups.values()].sort((a, b) => a.woodId - b.woodId || compare(a.name, b.name) || b.length - a.length || b.width - a.width);
  return { rows, woods: [...woods.values()].sort((a, b) => a.id - b.id) };
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
  // Face frame parts: solid wood, cut to these sizes.
  if (list.solid?.length) {
    lines.push('', units === 'in' ? 'Qty,Face frame part,Wood,Thickness (mm),Length (in),Width (in),Joinery,Cabinets' : 'Qty,Face frame part,Wood,Thickness,Length,Width,Joinery,Cabinets');
    for (const r of list.solid) {
      lines.push([r.qty, esc(r.name), esc(r.wood), r.thickness, len(r.length), len(r.width), esc(r.joinery), esc(r.cabinets.join('; '))].join(','));
    }
  }
  return lines.join('\n') + '\n';
}
