// Supply list for a job: sheet goods and edge banding (from the cut list),
// countertops by length, paint by painted area (paint.js), plus the hardware the built parts call for. Sheet counts come from the
// nesting plan, which the caller passes in once it is ready.

import { runLabel } from './countertop.js';
import { cutList } from './cutlist.js';
import { fmtMm, materialById } from './model.js';
import { paintNeeded } from './paint.js';
import { FT_PER_M, csvLen, unitName } from './units.js';

/**
 * @param cabinets built cabinets
 * @param c        job construction
 * @param sheets   optional Map of library material id → sheets needed
 * @param tops     the job's countertops (countertops(p, built))
 * @returns {{ sheets: object[], woods: object[], bands: object[], tops: object[], paint: object, hardware: object[], edgeBandM: number, topM: number,
 *             materialCost: number | null, hardwareCost: number, totalCost: number | null }}
 *   `paint` is paintNeeded's result; its cost is in the material cost.
 *   Sheet, band, countertop and hardware rows carry `unitCost` (per sheet / metre / unit,
 *   0 when not priced) and `cost`; sheet costs, `materialCost` and
 *   `totalCost` are null until the sheet counts are known. Hinges and slides
 *   are priced from the job construction, not each cabinet's overrides.
 */
export function supplies(cabinets, c, sheets = null, tops = []) {
  const list = cutList(cabinets, c);
  const sheetRows = list.materials.map((m) => {
    const lib = materialById(c, m.id);
    const unitCost = lib?.cost || 0;
    const count = sheets?.get(m.id) ?? null;
    return {
      id: m.id,
      material: m.material,
      thickness: m.thickness,
      parts: m.parts,
      areaM2: m.areaM2,
      sheetLength: lib?.sheetLength ?? 0,
      sheetWidth: lib?.sheetWidth ?? 0,
      sheets: count,
      unitCost,
      cost: count == null ? null : count * unitCost,
    };
  });
  const bandRows = list.bands.map((b) => {
    const unitCost = materialById(c, b.id)?.cost || 0;
    return { ...b, unitCost, cost: b.m * unitCost };
  });
  const ct = c.countertop;
  const topRows = tops.map((t) => {
    const m = t.length / 1000;
    const unitCost = ct?.cost || 0;
    return { name: ct?.name || 'Countertop', run: runLabel(t), length: t.length, depth: t.depth, thickness: t.thickness, m, unitCost, cost: m * unitCost };
  });
  // Face frame wood, by board feet (cutlist.js solidCutList).
  const woodRows = list.woods ?? [];
  const sheetCost = sheetRows.some((m) => m.cost == null) ? null : sheetRows.reduce((n, m) => n + m.cost, 0);

  const hardware = new Map();
  const add = (key, item, spec, qty, unit = 'pcs', unitCost = 0) => {
    if (!hardware.has(key)) hardware.set(key, { item, spec, qty: 0, unit, unitCost: unitCost || 0, cabinets: [] });
    hardware.get(key).qty += qty;
  };
  const used = (key, cabinet) => {
    const row = hardware.get(key);
    if (row && !row.cabinets.includes(cabinet)) row.cabinets.push(cabinet);
  };
  for (const cab of cabinets) {
    for (const p of cab.parts) {
      if (p.role === 'door' && p.hinge?.type === 'butt') {
        const name = p.hinge.name ?? 'Butt hinge';
        const prof = c.styleHinges?.[p.hinge.style];
        add(`butt|${p.hinge.style}|${name}`, 'Hinge', `${name}, mortised`, p.hinge.count, 'pcs', prof?.buttCost);
        used(`butt|${p.hinge.style}|${name}`, cab.name);
      } else if (p.role === 'door' && p.hinge) {
        const name = p.hinge.name ?? 'Cup hinge';
        // The inset and face-frame hinges are priced on their own.
        const prof = p.hinge.style ? c.styleHinges?.[p.hinge.style] : null;
        const [cost, plateCost] = prof ? [prof.cost, prof.plateCost] : [c.hinge.cost, c.hinge.plateCost];
        add(`hinge|${name}`, 'Hinge', `${name}, 35 mm cup`, p.hinge.count, 'pcs', cost);
        const plate = p.hinge.plate == null ? '' : `, ${fmtMm(p.hinge.plate)} mm`;
        add(`plate|${name}${plate}`, 'Hinge mounting plate', `for ${name}${plate}`, p.hinge.count, 'pcs', plateCost);
        used(`hinge|${name}`, cab.name);
        used(`plate|${name}${plate}`, cab.name);
      } else if (p.role === 'drawerFront' && p.slide) {
        const key = `slide|${p.slide.name}|${p.slide.length}`;
        add(key, 'Drawer slides', `${p.slide.name}, ${p.slide.length} mm`, 1, 'pairs', c.slide.cost);
        used(key, cab.name);
      } else if (p.role === 'shelf') {
        const key = 'shelfPin';
        add(key, 'Shelf pins', `Ø${c.system.diameter} mm, 4 per shelf`, 4);
        used(key, cab.name);
      }
    }
  }
  const order = ['Hinge', 'Hinge mounting plate', 'Drawer slides', 'Shelf pins'];
  for (const r of hardware.values()) r.cost = r.qty * r.unitCost;
  const hardwareCost = [...hardware.values()].reduce((n, r) => n + r.cost, 0);
  const paint = paintNeeded(cabinets, c);
  const materialCost = sheetCost == null ? null : sheetCost + [...bandRows, ...topRows, ...woodRows].reduce((n, r) => n + r.cost, 0) + paint.cost;
  return {
    sheets: sheetRows,
    woods: woodRows,
    bands: bandRows,
    tops: topRows,
    paint,
    edgeBandM: list.edgeBandM,
    topM: topRows.reduce((n, t) => n + t.m, 0),
    materialCost,
    hardwareCost,
    totalCost: materialCost == null ? null : materialCost + hardwareCost,
    hardware: [...hardware.values()].sort((a, b) => order.indexOf(a.item) - order.indexOf(b.item) || a.spec.localeCompare(b.spec)),
  };
}

/** The Materials report as CSV; sizes and lengths in the display units
 *  (`units` 'in': inches and feet), thicknesses in mm. */
export function suppliesCsv(s, { units = unitName() } = {}) {
  const inch = units === 'in';
  const size = (v) => (inch ? csvLen(v, 'in') : v.toFixed(0));
  const run = (m, digits) => (inch ? (m * FT_PER_M).toFixed(digits) : m.toFixed(digits));
  const runUnit = inch ? 'ft' : 'm';
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
  const money = (v) => (v ? v.toFixed(2) : '');
  const lines = ['Category,Item,Specification,Quantity,Unit,Unit cost,Cost'];
  for (const m of s.sheets) {
    const spec = `${m.thickness} mm, ${size(m.sheetLength)} × ${size(m.sheetWidth)}${inch ? ' in' : ''}`;
    lines.push(['Sheet goods', m.material, spec, m.sheets ?? '', 'sheets', money(m.unitCost), money(m.cost)].map(esc).join(','));
  }
  for (const w of s.woods ?? []) {
    const spec = `${w.quarters}/4 rough, ${w.parts} face frame parts, ${w.waste}% waste`;
    lines.push(['Solid wood', w.name, spec, w.boardFeet.toFixed(1), 'bd ft', money(w.unitCost), money(w.cost)].map(esc).join(','));
  }
  for (const b of s.bands) {
    const spec = `${b.type ? `${b.type}, ` : ''}${b.thickness} mm`;
    lines.push(['Edge banding', b.name, spec, run(b.m, 1), runUnit, money(b.unitCost), money(b.cost)].map(esc).join(','));
  }
  for (const t of s.tops) {
    const spec = inch ? `${t.run}, ${size(t.length)} × ${size(t.depth)} × ${size(t.thickness)} in` : `${t.run}, ${fmtMm(t.length)} × ${fmtMm(t.depth)} × ${fmtMm(t.thickness)} mm`;
    lines.push(['Countertop', t.name, spec, run(t.m, 2), runUnit, money(t.unitCost), money(t.cost)].map(esc).join(','));
  }
  for (const pr of s.paint?.products ?? []) {
    const spec = `${pr.coats} coat${pr.coats === 1 ? '' : 's'} over ${s.paint.areaFt2.toFixed(0)} ft², ${pr.qty.toFixed(2)} ${pr.unit} used`;
    lines.push(['Paint', pr.name, spec, pr.buy, pr.unit, money(pr.unitCost), money(pr.cost)].map(esc).join(','));
  }
  for (const r of s.hardware) lines.push(['Hardware', r.item, r.spec, r.qty, r.unit, money(r.unitCost), money(r.cost)].map(esc).join(','));
  if (s.materialCost) lines.push(['Total', 'Materials', '', '', '', '', money(s.materialCost)].map(esc).join(','));
  if (s.hardwareCost) lines.push(['Total', 'Hardware', '', '', '', '', money(s.hardwareCost)].map(esc).join(','));
  if (s.totalCost) lines.push(['Total', 'Job', '', '', '', '', money(s.totalCost)].map(esc).join(','));
  return lines.join('\n') + '\n';
}
