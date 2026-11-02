// Paint for a job: the painted area of the built parts (faces and edges, by
// part type, as the construction's paint settings say) and, for each paint
// product (sealer, primer, top coat…), how much it takes for its coats and
// what it costs, bought in whole containers.
//
//   paint: { enabled, products: [{ name, coats, coverage (ft² per container),
//            unit ('gal'), cost (per container) }], parts: { group: { faces
//            (0, 1 or 2), edges } } }

import { isFramePart, isFront, isFrontPanel, isPlinth } from './part.js';

export const FT2_PER_M2 = 10.7639;

// Part types that can be painted. A standing panel (an end panel on its own
// in a run) shows both faces, an end panel on a cabinet one.
export const PAINT_GROUPS = {
  fronts: 'Doors & drawer fronts',
  fillers: 'Fillers',
  endPanels: 'End panels',
  panels: 'Standing panels',
  sides: 'Case sides',
  shelves: 'Shelves',
  plinth: 'Toe kicks & plinths',
  kickCovers: 'Toe kick covers',
  frames: 'Face frames',
};

/** The paint group a part belongs to, or null if it is never painted. */
export function paintGroup(part) {
  const r = part.role;
  if (isFront(r) || isFrontPanel(r)) return 'fronts';
  if (r === 'filler') return 'fillers';
  if (r === 'endPanel') return part.standing ? 'panels' : 'endPanels';
  if (r === 'leftSide' || r === 'rightSide') return 'sides';
  if (r === 'shelf' || r === 'fixedShelf') return 'shelves';
  if (r === 'toeKickCover') return 'kickCovers';
  if (isPlinth(r)) return 'plinth';
  if (isFramePart(r)) return 'frames';
  return null;
}

/** A polygon's area and perimeter ([[x, y], …]). */
function polygon(points) {
  let area = 0;
  let perimeter = 0;
  points.forEach(([x0, y0], i) => {
    const [x1, y1] = points[(i + 1) % points.length];
    area += x0 * y1 - x1 * y0;
    perimeter += Math.hypot(x1 - x0, y1 - y0);
  });
  return { area: Math.abs(area) / 2, perimeter };
}

/** A part's painted area in mm² under group settings `g`. A shaker frame's
 *  opening takes its area off the faces and adds its edges. */
function paintedArea(part, g) {
  let { area, perimeter } = part.outline ? polygon(part.outline) : { area: part.length * part.width, perimeter: 2 * (part.length + part.width) };
  for (const op of part.ops.filter((op) => op.type === 'opening')) {
    area -= op.length * op.width;
    perimeter += 2 * (op.length + op.width);
  }
  return area * (g.faces ?? 0) + (g.edges ? perimeter * part.thickness : 0);
}

/**
 * @param cabinets built cabinets
 * @param c        job construction
 * @returns {{ groups: { id, label, parts, areaM2 }[], areaM2, areaFt2,
 *             products: { name, coats, coverage, unit, unitCost, qty, buy, cost, actualCost }[], cost }}
 *   `qty` is the containers the coats take, `buy` that rounded up to whole
 *   containers; `cost` is buy × price, `actualCost` qty × price. Empty when
 *   paint is off.
 */
export function paintNeeded(cabinets, c) {
  const paint = c.paint;
  const empty = { groups: [], areaM2: 0, areaFt2: 0, products: [], cost: 0 };
  if (!paint?.enabled) return empty;
  const groups = new Map();
  for (const cab of cabinets) {
    for (const part of cab.parts) {
      const id = paintGroup(part);
      const g = id && paint.parts?.[id];
      if (!g || (!g.faces && !g.edges)) continue;
      if (!groups.has(id)) groups.set(id, { id, label: PAINT_GROUPS[id], parts: 0, areaM2: 0 });
      const row = groups.get(id);
      row.parts += 1;
      row.areaM2 += paintedArea(part, g) / 1e6;
    }
  }
  const rows = Object.keys(PAINT_GROUPS).filter((id) => groups.has(id)).map((id) => groups.get(id));
  const areaM2 = rows.reduce((n, r) => n + r.areaM2, 0);
  const areaFt2 = areaM2 * FT2_PER_M2;
  const products = (paint.products ?? []).map((pr) => {
    const qty = pr.coverage > 0 ? (areaFt2 * (pr.coats || 0)) / pr.coverage : 0;
    // Whole containers, without buying one for a rounding crumb.
    const buy = Math.ceil(qty - 1e-9);
    const unitCost = pr.cost || 0;
    return { name: pr.name, coats: pr.coats || 0, coverage: pr.coverage, unit: pr.unit || 'gal', unitCost, qty, buy, cost: buy * unitCost, actualCost: qty * unitCost };
  });
  return { groups: rows, areaM2, areaFt2, products, cost: products.reduce((n, p) => n + p.cost, 0) };
}
