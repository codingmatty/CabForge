// Engine tests. Open tests/ in a browser; the page title reports PASS/FAIL.

import { buildCabinet, hingeBoring, hingeCount } from '../assets/js/engine/build.js';
import { cutList, cutListCsv } from '../assets/js/engine/cutlist.js';
import {
  bandThickness,
  caseT,
  ensureBands,
  ensurePanelMaterial,
  defaultConstruction,
  drawerBase,
  newCabinet,
  defaultSheetSize,
  frontUnits,
  DEFAULT_FILLER_WIDTH,
  newFiller,
  splitUnits,
  newMaterial,
  newPanel,
  newSection,
  newSpace,
  nextMaterialId,
  stackFronts,
  thickness,
  unitFrontHeight,
  usStandardSizes,
} from '../assets/js/engine/model.js';
import { bandGroup, boxIntersection, boxMax, bores, cutSize, isDrawerBox, isPlinth, partSolids } from '../assets/js/engine/part.js';
import { nestGroup, nestItems, nestJob } from '../assets/js/engine/nest.js';
import { applianceSketch } from '../assets/js/engine/appliance.js';
import { countertops } from '../assets/js/engine/countertop.js';
import { FT2_PER_M2, paintNeeded } from '../assets/js/engine/paint.js';
import { cornerDoors, newCorner } from '../assets/js/engine/corner.js';
import { addIsland, addWall, ensureRoom, locations } from '../assets/js/engine/room.js';
import { cncGroups, cncNesting, gcode, notchedOutline, onStock, sheetProgram, stockOutline, stockRect, tablePart } from '../assets/js/engine/cnc.js';
import { solidcraftDesign } from '../assets/js/engine/solidcraft.js';
import { AI_TOOLS, ToolError, layoutSummary, runTool, systemPrompt } from '../assets/js/engine/aitools.js';
import { MM_PER_IN, fmtLen, fmtLenU, fmtSize, formatInches, parseLen, setUnits } from '../assets/js/engine/units.js';
import { supplies, suppliesCsv } from '../assets/js/engine/supplies.js';
import { addCabinet, baseSource, buildAll, emptyProject, insertCabinet, jobFor, maxBoardLength, moveCabinet, newProject, placeAfter, placedParts, splitBoards, placedAfter, projectCutList, relayout, resizeCabinet, runNeighbours } from '../assets/js/engine/project.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
const approx = (a, b) => Math.abs(a - b) < 1e-6;
function assertApprox(a, b, msg = '') {
  assert(approx(a, b), `${msg} expected ${b}, got ${a}`);
}
function assertEq(a, b, msg = '') {
  const [ja, jb] = [JSON.stringify(a), JSON.stringify(b)];
  assert(ja === jb, `${msg} expected ${jb}, got ${ja}`);
}

const part = (cab, role) => {
  const p = cab.parts.find((p) => p.role === role);
  assert(p, `no ${role}`);
  return p;
};
const count = (cab, role) => cab.parts.filter((p) => p.role === role).length;
const pockets = (p) => p.ops.filter((op) => op.type === 'pocket');
const base = () => [newCabinet('base', 1), defaultConstruction()];
const caseHeight = (spec, c) => part(buildCabinet(spec, c), 'leftSide').length;

test('base cabinet case parts', () => {
  const [spec, c] = base();
  const cab = buildCabinet(spec, c);
  const t = caseT(c);
  const side = part(cab, 'leftSide');
  assertApprox(side.length, spec.height - c.toeKickHeight);
  assertApprox(side.width, spec.depth);
  assertApprox(side.bbox.min[1], c.toeKickHeight);
  // Butt joints throughout: no joinery machining on sides or bottom.
  const bottom = part(cab, 'bottom');
  assertApprox(bottom.length, spec.width - 2 * t);
  assertApprox(bottom.bbox.min[0], t);
  assert(pockets(side).length === 0 && pockets(bottom).length === 0);
  assertApprox(part(cab, 'frontStretcher').length, spec.width - 2 * t);
  assertApprox(part(cab, 'frontStretcher').width, 120);
  assertEq(count(cab, 'frontStretcher'), 1);
  assertEq(count(cab, 'rearStretcher'), 1);
  assertEq(count(cab, 'top'), 0);
  assertEq(count(cab, 'toeKick'), 1);
  assertEq(count(cab, 'shelf'), 1);
});

test('wall cabinet has top and no plinth', () => {
  const spec = newCabinet('wall', 1);
  const cab = buildCabinet(spec, defaultConstruction());
  assertEq(count(cab, 'top'), 1);
  assertEq(count(cab, 'toeKick'), 0);
  assertApprox(part(cab, 'leftSide').length, spec.height);
});

test('every side hole is on the 32mm grid', () => {
  const c = defaultConstruction();
  const onGrid = (v, origin) => {
    const k = (v - origin) / c.system.spacing;
    return Math.abs(k - Math.trunc(k)) < 1e-9;
  };
  for (const spec of [newCabinet('base', 1), newCabinet('wall', 2), newCabinet('tall', 3)]) {
    const cab = buildCabinet(spec, c);
    for (const role of ['leftSide', 'rightSide']) {
      for (const b of bores(part(cab, role))) {
        assert(onGrid(b.x, c.system.origin), `${spec.name} ${role} ${b.purpose} x=${b.x}`);
        assert(onGrid(b.y, c.system.frontSetback), `${spec.name} ${role} ${b.purpose} y=${b.y}`);
      }
    }
  }
});

test('hinge cups match side plates', () => {
  const [spec, c] = base();
  const cab = buildCabinet(spec, c);
  const door = part(cab, 'door');
  const side = part(cab, 'leftSide');
  const doorBottom = door.bbox.min[1] - side.bbox.min[1];
  const cups = bores(door)
    .filter((b) => b.purpose === 'hingeCup')
    .map((b) => b.x + doorBottom);
  assertEq(cups.length, hingeCount(door.length));
  for (const x of cups) {
    // RCS plate: two screws on the front system line, 16 above and below the hinge.
    const plateHoles = bores(side).filter(
      (b) => b.purpose === 'hingePlate' && approx(Math.abs(b.x - x), 16) && approx(b.y, c.system.frontSetback),
    ).length;
    assertEq(plateHoles, 2, `hinge at side x=${x} needs two plate holes`);
  }
  // Single door hinged left: right side has no plate holes.
  assert(bores(part(cab, 'rightSide')).every((b) => b.purpose !== 'hingePlate'));
});

test('hinge cup boring follows door thickness', () => {
  const [spec, c] = base();
  // 16 case, 1.5 reveal: 14.5 overlay. 2 mm plate → K 4.5; 4 mm → K 6.5,
  // which 19 mm doors can't swing open at.
  assertEq(caseT(c), 16);
  assertEq(thickness(c, 'front'), 19);
  const b = hingeBoring(c);
  assertApprox(b.k, 4.5);
  assertApprox(b.cupCenter, 22);
  assertEq(b.plate, 2);
  assertEq(b.issues, []);
  const cab = buildCabinet(spec, c);
  const door = part(cab, 'door');
  for (const cup of bores(door).filter((b) => b.purpose === 'hingeCup')) assertApprox(cup.y, 22);
  assertEq(door.hinge.plate, 2);

  // 14 mm doors swing at K 6.5 too; the preferred K 7 picks it.
  const thin = { ...c, library: c.library.map((m) => (m.id === c.materials.front ? { ...m, thickness: 14 } : m)), hinge: { ...c.hinge, k: 7 } };
  assertApprox(hingeBoring(thin).k, 6.5);
  assertEq(hingeBoring(thin).plate, 4);

  // 22 mm doors: no K swings with 1.5 reveals, so it says so.
  const thick = { ...c, library: c.library.map((m) => (m.id === c.materials.front ? { ...m, thickness: 22 } : m)) };
  assert(hingeBoring(thick).issues.length > 0, 'thick doors should report an issue');

  // Fixed K drills where it's told and picks the nearest plate.
  const fixed = { ...c, hinge: { ...c.hinge, boring: 'manual', k: 5 } };
  assertApprox(hingeBoring(fixed).cupCenter, 22.5);
  const right = buildCabinet({ ...spec, width: 900 }, fixed).parts.find((p) => p.name === 'Right door');
  for (const cup of bores(right).filter((b) => b.purpose === 'hingeCup')) assertApprox(cup.y, right.width - 22.5);
});

test('wide cabinet gets two doors with gap', () => {
  const [spec, c] = base();
  spec.width = 900;
  const cab = buildCabinet(spec, c);
  const doors = cab.parts.filter((p) => p.role === 'door');
  assertEq(doors.length, 2);
  const r = c.reveals;
  assertApprox(doors[0].width, (spec.width - 2 * r.side - r.gap) / 2);
  assertApprox(doors[1].bbox.min[0] - boxMax(doors[0].bbox)[0], r.gap);
});

test('drawer stack fits case', () => {
  const c = defaultConstruction();
  const spec = drawerBase(1, 3);
  const cab = buildCabinet(spec, c);
  assertEq(count(cab, 'drawerFront'), 3);
  assertEq(count(cab, 'drawerSide'), 6);
  assertEq(count(cab, 'drawerBottom'), 3);
  const t = caseT(c);
  const backFace = boxMax(part(cab, 'back').bbox)[2];
  for (const p of cab.parts.filter((p) => isDrawerBox(p.role))) {
    const [min, max] = [p.bbox.min, boxMax(p.bbox)];
    assert(min[0] >= t && max[0] <= spec.width - t, `${p.name} fits between sides`);
    assert(min[2] > backFace, `${p.name} clears the back`);
    assert(max[1] <= spec.height - t, `${p.name} under the stretchers`);
  }
  // New drawer bases are in units: a 5-unit top drawer, then 9 / 10, less than a unit left at the bottom.
  const height = (cab) => cab.parts.filter((p) => p.role === 'drawerFront').reduce((s, p) => s + p.width, 0);
  const zone = spec.height - c.toeKickHeight - c.reveals.top - c.reveals.bottom;
  assertEq(spec.fronts.sections.map((s) => s.units).join(), '5,9,10');
  const left = zone - height(cab) - 2 * c.reveals.gap;
  assert(left >= 0 && left < c.drawerUnit, `${left} mm left`);
  // Equal fronts tile the face exactly: total height + gaps.
  spec.fronts = { type: 'drawers', count: 3 };
  assertApprox(height(buildCabinet(spec, c)) + 2 * c.reveals.gap, zone);
});

test('shallow cabinet rejects drawers', () => {
  const spec = drawerBase(1, 2);
  spec.depth = 200;
  let threw = false;
  try {
    buildCabinet(spec, defaultConstruction());
  } catch (e) {
    threw = e.name === 'BuildError';
  }
  assert(threw);
});

test('invalid sizes are errors', () => {
  const [spec, c] = base();
  spec.width = 50;
  let threw = false;
  try {
    buildCabinet(spec, c);
  } catch (e) {
    threw = e.name === 'BuildError';
  }
  assert(threw);
});

test('edge banding follows the construction per part type', () => {
  const [spec, c] = base();
  c.edgeBanding.side = { l1: true, l2: true, w1: false, w2: true };
  c.edgeBanding.door = { l1: true, l2: true, w1: false, w2: false };
  const cab = buildCabinet(spec, c);
  const side = part(cab, 'rightSide');
  assertEq(side.edges, { l1: true, l2: true, w1: false, w2: true });
  const [l, w] = cutSize(side, c.edgeBandThickness);
  assertApprox(l, side.length - 1);
  assertApprox(w, side.width - 2);
  assertEq(part(cab, 'door').edges, { l1: true, l2: true, w1: false, w2: false });
  // Parts the setting doesn't touch keep the defaults.
  assertEq(part(cab, 'bottom').edges, { l1: true, l2: false, w1: false, w2: false });
  const before = cutList([buildCabinet(spec, defaultConstruction())], defaultConstruction()).edgeBandM;
  assert(cutList([cab], c).edgeBandM > before, 'more banding in the cut list');
});

test('edge band thickness and totals come from the selected band material', () => {
  const [spec, c] = base();
  const veneer = newMaterial(nextMaterialId(c), 'Veneer', 'Edge band', 0.5, '#d9b98c');
  c.library.push(veneer);
  c.bands.front = veneer.id;
  const cab = buildCabinet(spec, c);
  const door = part(cab, 'door');
  assertEq(door.bandId, veneer.id);
  const [l, w] = cutSize(door, bandThickness(c, door));
  assertApprox(l, door.length - 1);
  assertApprox(w, door.width - 1);
  const list = cutList([cab], c);
  assertEq(list.bands.map((b) => b.name), ['White PVC', 'Veneer']);
  assertEq(list.bands[0].type, 'PVC');
  const doorBand = 2 * (door.length + door.width) / 1000;
  assertApprox(list.bands[1].m, doorBand, 'veneer length');
  assertApprox(list.bands[0].m + list.bands[1].m, list.edgeBandM, 'total');
  assert(list.rows.find((r) => r.name === 'Door').band === 'Veneer');
});

test('each part type can use its own edge band', () => {
  const [spec, c] = base();
  const abs = { ...newMaterial(nextMaterialId(c), 'Grey ABS', 'Edge band', 2, '#888888'), bandType: 'ABS' };
  c.library.push(abs);
  c.bands.front = abs.id; // the fronts' material band…
  ensureBands(c);
  assertEq(c.partBands.door, abs.id, 'part types start from their material band');
  assertEq(c.partBands.side, c.bands.case);
  c.partBands.door = c.bands.case; // …but doors get the white PVC
  c.partBands.shelf = abs.id; // and shelves the ABS
  const cab = buildCabinet(spec, c);
  const door = part(cab, 'door');
  assertEq(door.bandId, c.bands.case);
  assertApprox(cutSize(door, bandThickness(c, door))[0], door.length - 2);
  const shelf = part(cab, 'shelf');
  assertEq(shelf.bandId, abs.id);
  assertApprox(cutSize(shelf, bandThickness(c, shelf))[1], shelf.width - 2);
  assertEq(cutList([cab], c).bands.map((b) => b.name), ['White PVC', 'Grey ABS']);
});

test('older saves get an edge band material from their band thickness', () => {
  const c = defaultConstruction();
  c.library = c.library.filter((m) => !m.edgeBand);
  c.edgeBandThickness = 2;
  c.bands = { case: 1, front: 1, drawerBox: 1 }; // sheet materials, not bands
  ensureBands(c);
  const band = c.library.find((m) => m.edgeBand);
  assert(band && band.thickness === 2, 'band made from the old thickness');
  assertEq(c.bands, { case: band.id, front: band.id, drawerBox: band.id, panel: band.id });
  assert(band.kind === 'Edge band', 'band type');
  const before = JSON.stringify(c);
  ensureBands(c);
  assert(JSON.stringify(c) === before, 'idempotent');
  // A band saved with the earlier checkbox (any type) becomes type Edge band.
  const old = { ...newMaterial(nextMaterialId(c), 'Maple', 'Other', 0.5, '#e0c090'), edgeBand: true };
  c.library.push(old);
  ensureBands(c);
  assert(old.kind === 'Edge band' && old.edgeBand, 'checkbox band migrated');
  assert(old.bandType === c.edgeBandTypes[0], 'band given the first type');
  // A band whose type is missing from the list puts it back.
  c.library.push({ ...newMaterial(nextMaterialId(c), 'Oak', 'Edge band', 0.6, '#b08850'), bandType: 'Oak veneer' });
  ensureBands(c);
  assert(c.edgeBandTypes.includes('Oak veneer'), 'type restored');
});

test('new cabinets take their sizes from the construction', () => {
  const c = defaultConstruction();
  const b = newCabinet('base', 1, c);
  assertEq([b.width, b.height, b.depth], [600, 768 + 110, 610], 'base: box + toe kick');
  assertEq(caseHeight(b, c), 768, 'case is the box height');
  assertEq(newCabinet('wall', 2, c).height, 720, 'wall: no toe kick');
  assertEq(drawerBase(3, 3, c).height, 878, 'drawer base');
  assertEq(newFiller('base', 4, c).height, 878, 'base filler matches');
  c.cabinetSizes.base = { width: 450, boxHeight: 800, depth: 560 };
  c.plinth = 'none';
  const b2 = newCabinet('base', 5, c);
  assertEq([b2.width, b2.height, b2.depth], [450, 800, 560], 'edited sizes, no toe kick');
  // Without a construction the old fixed defaults still apply.
  assertEq(newCabinet('base', 6).height, 880);
});

test('supply list counts sheets, banding and hardware', () => {
  const c = defaultConstruction();
  const drawers = buildCabinet(drawerBase(1, 3), c);
  const doors = buildCabinet({ ...newCabinet('base', 2), shelves: 1 }, c); // one 600 door, 880 high
  const tall = buildCabinet({ ...newCabinet('tall', 3), width: 800 }, c); // a pair of tall doors
  const cabs = [drawers, doors, tall];
  const s = supplies(cabs, c, new Map([[1, 3], [2, 1], [3, 1]]));
  const row = (item) => s.hardware.filter((r) => r.item === item);
  const tallDoors = tall.parts.filter((p) => p.role === 'door');
  const expectedHinges = 2 + tallDoors.reduce((n, d) => n + hingeCount(d.length), 0);
  assertEq(row('Hinge')[0].qty, expectedHinges, 'hinges');
  assertEq(row('Hinge mounting plate')[0].qty, expectedHinges, 'plates');
  assertEq(row('Drawer slides').map((r) => [r.qty, r.unit]), [[3, 'pairs']], 'one pair per drawer');
  assert(row('Drawer slides')[0].spec.includes('550 mm'), 'slide length');
  const shelves = cabs.flatMap((cab) => cab.parts).filter((p) => p.role === 'shelf').length;
  assertEq(row('Shelf pins')[0].qty, shelves * 4, 'shelf pins');
  assertEq(s.sheets.find((m) => m.id === 1).sheets, 3, 'sheet count from nesting');
  assertApprox(s.edgeBandM, cutList(cabs, c).edgeBandM);
  const csv = suppliesCsv(s);
  assert(csv.includes('Hardware,Drawer slides') && csv.includes('Edge banding,White PVC'), 'csv rows');
});

test('supply list prices sheets and banding', () => {
  const c = defaultConstruction();
  const cabs = [buildCabinet(newCabinet('base', 1), c)];
  c.library.find((m) => m.id === 1).cost = 85.5; // case, per sheet
  c.library.find((m) => m.id === 4).cost = 0.4; // band, per metre
  // Fronts (id 2) left unpriced.
  assertEq(supplies(cabs, c).materialCost, null, 'no cost before sheet counts');
  const s = supplies(cabs, c, new Map([[1, 2], [2, 1]]));
  const sheet = (id) => s.sheets.find((m) => m.id === id);
  assertApprox(sheet(1).cost, 171);
  assertEq(sheet(2).unitCost, 0);
  assertApprox(s.bands[0].cost, s.bands[0].m * 0.4);
  assertApprox(s.materialCost, 171 + s.bands.reduce((n, b) => n + b.cost, 0) + s.paint.cost);
  const csv = suppliesCsv(s);
  assert(csv.startsWith('Category,Item,Specification,Quantity,Unit,Unit cost,Cost'), 'csv header');
  assert(csv.includes(',sheets,85.50,171.00'), 'csv sheet cost');
  assert(csv.includes(`Total,Materials,,,,,${s.materialCost.toFixed(2)}`), 'csv total');
});

test('countertops: one continuous top per base run, length in the supply list only', () => {
  const p = newProject(); // drawer base + base side by side, then a tall cabinet, walls above
  const c = p.construction;
  let tops = countertops(p, buildAll(p));
  assertEq(tops.length, 1);
  const front = c.cabinetSizes.base.depth + thickness(c, 'front');
  assertApprox(tops[0].x0, 0);
  assertApprox(tops[0].length, 1200);
  assertApprox(tops[0].depth, front + c.countertop.frontOverhang);
  assertApprox(tops[0].y, p.cabinets[0].height);
  assertEq(tops[0].cabinets.length, 2);
  // A filler continues the run; a base cabinet past the tall one starts another; an end panel lengthens its run.
  insertCabinet(p, newFiller('base', 0, c), 2);
  addCabinet(p, newCabinet('base', 0, c));
  p.cabinets[0].endPanels = { left: true, right: false };
  relayout(p);
  c.countertop.endOverhang = 10;
  const built = buildAll(p);
  tops = countertops(p, built);
  assertEq(tops.length, 2);
  assertEq(tops[0].cabinets.length, 3);
  const panel = thickness(c, 'front');
  assertApprox(tops[0].length, panel + 1200 + 50 + 20);
  assertApprox(tops[1].length, 620);
  // Not parts: the cut list doesn't change.
  assert(!projectCutList(p, built).rows?.some?.((r) => /counter/i.test(r.name)));
  c.countertop.cost = 100;
  const s = supplies(built.map((b) => b.cabinet), c, new Map(), tops);
  assertEq(s.tops.length, 2);
  assertApprox(s.topM, (tops[0].length + tops[1].length) / 1000);
  assertApprox(s.tops[0].cost, (tops[0].length / 1000) * 100);
  assert(suppliesCsv(s).includes('Countertop,Countertop'));
  c.countertop.enabled = false;
  assertEq(countertops(p, built).length, 0);
});

test('room: walls turn 90° at their ends; cabinets stand at their wall in world space', () => {
  const p = emptyProject();
  const c = p.construction;
  p.room.walls[0].length = 3000;
  const w2 = addWall(p);
  const [l1, l2] = locations(p);
  assertEq(l2.origin.join(), '3000,0');
  assertEq(l2.u.join(), '0,1'); // runs out into the room
  assertEq(l2.n.join(), '-1,0'); // facing back across wall 1
  addCabinet(p, newCabinet('base', 0, c));
  const b = newCabinet('base', 0, c);
  b.at = w2;
  addCabinet(p, b);
  assertEq(b.x, 0);
  const built = buildAll(p);
  const left = placedParts(p, built).find((pp) => pp.cabinet === 1 && pp.part.role === 'leftSide');
  // Its left side is at the corner end of wall 2, against the wall, 16 thick along z.
  assertApprox(left.min[2], 0);
  assertApprox(left.size[2], caseT(c));
  assertApprox(left.min[0] + left.size[0], 3000);
  assertApprox(left.size[0], b.depth);
  // An outside corner turns the other way.
  p.room.walls[1].turn = 'outside';
  assertEq(locations(p)[1].n.join(), '1,0');
  // Old jobs get a room with one wall long enough for their cabinets.
  const old = { cabinets: [{ ...newCabinet('base', 1), x: 4000 }], construction: c };
  ensureRoom(old);
  assertEq(old.room.walls.length, 1);
  assert(old.room.walls[0].length >= 4600);
  assertEq(old.cabinets[0].at, 'w1');
});

test('islands: single with a seating overhang, back to back under one top', () => {
  const p = emptyProject();
  const c = p.construction;
  const at = addIsland(p);
  for (let i = 0; i < 2; i++) {
    const b = newCabinet('base', 0, c);
    b.at = at;
    addCabinet(p, b);
  }
  let tops = countertops(p, buildAll(p));
  assertEq(tops.length, 1);
  const front = c.cabinetSizes.base.depth + thickness(c, 'front');
  assertApprox(tops[0].length, 1200);
  assertApprox(tops[0].z0, -300); // seating overhang behind
  assertApprox(tops[0].depth, 300 + front + c.countertop.frontOverhang);
  p.room.islands[0].type = 'double';
  const back = newCabinet('base', 0, c);
  back.at = `${at}b`;
  addCabinet(p, back);
  const built = buildAll(p);
  // The back row faces the other way, behind the front row's backs.
  const door = placedParts(p, built).find((pp) => pp.cabinet === 2 && pp.part.role === 'door');
  const island = p.room.islands[0];
  const line = locations(p).find((l) => l.id === at).origin[1];
  assert(door.min[2] + door.size[2] <= line - c.cabinetSizes.base.depth + 1e-6, 'back row door faces -z');
  // (x, z) is the top-left of both rows in the plan: the back row's fronts.
  assertApprox(Math.min(...placedParts(p, built).filter((pp) => pp.cabinet === 2).map((pp) => pp.min[2])), island.z);
  tops = countertops(p, built);
  assertEq(tops.length, 1);
  assertEq(tops[0].cabinets.length, 3);
  // Seating overhang past the back row's fronts, end overhangs past both ends.
  assertApprox(tops[0].depth, 2 * (front + c.countertop.frontOverhang) + 300);
  island.overhang = 0;
  island.ends = 150;
  tops = countertops(p, built);
  assertApprox(tops[0].depth, 2 * (front + c.countertop.frontOverhang));
  assertApprox(tops[0].length, 1200 + 300);
});

test('islands turned 180°: spun in place, list order still left to right in the plan', () => {
  const p = emptyProject();
  const c = p.construction;
  const at = addIsland(p);
  const island = p.room.islands[0];
  Object.assign(island, { x: 1000, z: 2000, rotation: 180 });
  const [a, b] = [newCabinet('base', 0, c), newCabinet('base', 0, c)];
  b.width = 400;
  for (const s of [a, b]) {
    s.at = at;
    addCabinet(p, s);
  }
  const built = buildAll(p);
  const pp = placedParts(p, built);
  // Plinth boards left out: a joined one runs under both.
  const left = (i) => Math.min(...pp.filter((q) => q.cabinet === i && !isPlinth(q.part.role)).map((q) => q.min[0]));
  const top = Math.min(...pp.map((q) => q.min[2]));
  // The first cabinet is on the left, at x; the island's top edge at z.
  assertApprox(left(0), 1000);
  assertApprox(left(1), 1600);
  assertApprox(top, 2000);
  // Fronts face wall 1 (-z).
  const door = pp.find((q) => q.cabinet === 0 && q.part.role === 'door');
  assertApprox(door.min[2], 2000);
  // Resizing re-lays the row, the order unchanged.
  resizeCabinet(p, 0, 500);
  assertApprox(b.x, 0);
  assertApprox(a.x, 400);
});

test('corner base: L with two 300 doors, 590 deep, in the corner; the next wall starts after its return', () => {
  const p = emptyProject();
  const c = p.construction;
  p.room.walls[0].length = 2400;
  const w2 = addWall(p);
  addCabinet(p, newCabinet('base', 0, c));
  const corner = newCorner('base', 0, c);
  addCabinet(p, corner);
  const next = newCabinet('base', 0, c);
  next.at = w2;
  addCabinet(p, next);
  assertEq(corner.depth, 590);
  // It stands off both walls so its fronts line up with the 610 deep cabinets.
  const off = c.cabinetSizes.base.depth - 590;
  assertApprox(corner.x + corner.width + off, 2400);
  assertApprox(next.x, corner.corner.return + off);
  const d = cornerDoors(corner, c);
  assertApprox(d.openingA, 300);
  assertApprox(d.openingB, 300);
  const built = buildAll(p);
  assert(!built.some((b) => b.error), built.map((b) => b.error).join());
  const parts = built[1].cabinet.parts;
  const doors = parts.filter((q) => q.role === 'door');
  assertEq(doors.map((q) => q.width).join(), '300,300');
  // Each door's plates are in the side it hangs on, level with its cups.
  for (const [door, side] of [[doors[0], parts[0]], [doors[1], parts[1]]]) {
    const plates = side.ops.filter((o) => o.purpose === 'hingePlate').length;
    assertEq(plates, 2 * door.ops.filter((o) => o.purpose === 'hingeCup').length);
  }
  // Back corner cut at 45°, with a narrow back across it.
  const strip = parts.find((q) => q.name === 'Corner back');
  assertApprox(strip.width, c.corner.chamfer * Math.SQRT2);
  // In the room: the return door faces back across wall 1 (-x), at the end of wall 1.
  const pp = placedParts(p, built).filter((x) => x.cabinet === 1);
  const ret = pp.find((x) => x.part.name === 'Return door');
  assertApprox(ret.map.dir([0, 0, 1])[0], -1);
  assert(ret.min[0] < 2400 - corner.depth && ret.min[2] >= corner.depth - 1e-6, 'return door in front of the return');
  // Its door front lines up with the next cabinet's door front on wall 1.
  const doorA = pp.find((x) => x.part.name === 'Left door');
  const plain = placedParts(p, built).find((x) => x.cabinet === 0 && x.part.role === 'door');
  assertApprox(doorA.min[2] + doorA.size[2], plain.min[2] + plain.size[2]);
  // and the return door's with wall 2's cabinet.
  const plain2 = placedParts(p, built).find((x) => x.cabinet === 2 && x.part.role === 'door');
  assertApprox(ret.min[0], plain2.min[0]);
  // The L bottom is cut on its outline on the CNC.
  const bottom = parts.find((q) => q.role === 'bottom');
  const tp = tablePart(c, bottom);
  assertEq(tp.outline.length, 7);
  // The countertop runs to the corner on wall 1 and from the front of it on wall 2.
  const tops = countertops(p, built);
  const t1 = tops.find((t) => t.cabinets.includes(corner.name) && t.at === 'Wall 1');
  assertApprox(t1.x1, 2400);
  const t2 = tops.find((t) => t.at === 'Wall 2');
  assertApprox(t2.x0, off + 590 + thickness(c, 'front') + c.countertop.frontOverhang);
  // Its own stand-off, when set, wins.
  corner.corner.standOff = 10;
  relayout(p);
  assertApprox(corner.x + corner.width + 10, 2400);
});

test('a corner at the end of a wall: its cabinets line up from the corner; a wall can choose its start', () => {
  const p = emptyProject();
  const c = p.construction;
  const w2 = addWall(p);
  for (const sp of [newCabinet('base', 0, c), newCabinet('base', 0, c), newCorner('base', 0, c)]) addCabinet(p, sp);
  const [a, b, corner] = p.cabinets;
  const off = c.cabinetSizes.base.depth - corner.depth;
  assertApprox(corner.x + corner.width + off, 3600);
  assertApprox(b.x + b.width, corner.x); // against the corner
  assertApprox(a.x + a.width, b.x); // list order still left to right
  // A cabinet added later goes next to the corner, after the others in the list.
  const d = newCabinet('base', 0, c);
  addCabinet(p, d);
  assertApprox(d.x + d.width, corner.x);
  assertApprox(b.x + b.width, d.x);
  // Lining up from the start leaves the gap before the corner instead.
  p.room.walls[0].from = 'start';
  relayout(p);
  assertApprox(a.x, 0);
  assertApprox(corner.x + corner.width + off, 3600);
  // The next wall, with the corner returning onto its start, lines up from there.
  const e = newCabinet('base', 0, c);
  e.at = w2;
  addCabinet(p, e);
  assertApprox(e.x, corner.corner.return + off);
});

test('spaces: room in the run for an appliance, no parts; a range stops the countertop', () => {
  const p = emptyProject();
  const c = p.construction;
  addCabinet(p, newCabinet('base', 0, c));
  const dw = newSpace('dishwasher', 0, c);
  addCabinet(p, dw);
  addCabinet(p, newCabinet('base', 0, c));
  const range = newSpace('range', 0, c);
  addCabinet(p, range);
  addCabinet(p, newCabinet('base', 0, c));
  assertApprox(dw.x, 600);
  assertApprox(dw.width, 610);
  assertApprox(p.cabinets[2].x, 1210);
  assertApprox(range.width, 762);
  const built = buildAll(p);
  assertEq(built[1].cabinet.parts.length, 0);
  assert(!projectCutList(p, built).rows?.some?.((r) => /dishwasher|range/i.test(r.cabinet ?? '')));
  // Over the dishwasher the top runs on; at the range it stops.
  const tops = countertops(p, built);
  assertEq(tops.length, 2);
  assertApprox(tops[0].length, 600 + 610 + 600);
  assertApprox(tops[1].x0, range.x + range.width);
});

test('space sizes: new spaces start at the job’s sizes, a 0 height or depth the run’s', () => {
  const p = emptyProject();
  const c = p.construction;
  const fridge0 = newSpace('fridge', 0, c);
  assertApprox(fridge0.width, 914);
  assertApprox(fridge0.height, 1780); // room for a cabinet over it
  assertApprox(newSpace('range', 0, c).height, newCabinet('base', 0, c).height);
  c.spaceSizes.fridge = { width: 940, height: 1800, depth: 0 };
  c.spaceSizes.dishwasher = { width: 600, height: 0, depth: 0 };
  const fridge = newSpace('fridge', 0, c);
  assertEq([fridge.width, fridge.height, fridge.depth], [940, 1800, fridge0.depth]);
  assertApprox(newSpace('dishwasher', 0, c).width, 600);
});

test('standing panel: an end panel on its own in the run, as wide as the front material', () => {
  const p = emptyProject();
  const c = p.construction;
  addCabinet(p, newCabinet('base', 0, c));
  addCabinet(p, newSpace('dishwasher', 0, c));
  const panel = newPanel('base', 0, c);
  addCabinet(p, panel);
  addCabinet(p, newCabinet('base', 0, c));
  const et = thickness(c, 'front');
  assertApprox(panel.width, et);
  assertApprox(panel.x, 1210);
  assertApprox(p.cabinets[3].x, 1210 + et);
  const built = buildAll(p);
  assert(!built[2].error, built[2].error);
  const [part] = built[2].cabinet.parts;
  assertEq(built[2].cabinet.parts.length, 1);
  assertEq(part.role, 'endPanel');
  const ep = c.endPanel;
  assertApprox(part.thickness, et);
  assertApprox(part.length, panel.height + ep.floorScribe);
  assertApprox(part.width, panel.depth + ep.frontOverhang + ep.rearScribe);
  // Notched for the toe kick, like a cabinet's end panel.
  assertEq(part.ops.length, 1);
  assertApprox(part.ops[0].length, c.toeKickHeight + ep.floorScribe);
  // A thicker front material widens it and moves the cabinets after it.
  const front = c.materials.front;
  c.library.find((m) => m.id === front).thickness = 22;
  buildAll(p);
  assertApprox(panel.width, 22);
  assertApprox(p.cabinets[3].x, 1210 + 22);
  // The countertop runs on over the dishwasher and the panel.
  assertEq(countertops(p, buildAll(p)).length, 1);
});

test('paint: painted faces and edges by part type, coats ÷ coverage in whole gallons', () => {
  const p = emptyProject();
  const c = p.construction;
  addCabinet(p, newCabinet('base', 0, c));
  addCabinet(p, newFiller('base', 0, c));
  addCabinet(p, newPanel('base', 0, c));
  const built = buildAll(p);
  const cabs = built.map((b) => b.cabinet);
  const parts = cabs.flatMap((cab) => cab.parts);
  const faceAndEdges = (q, faces) => (q.length * q.width * faces + 2 * (q.length + q.width) * q.thickness) / 1e6;
  const paint = paintNeeded(cabs, c);
  const door = parts.find((q) => q.role === 'door');
  const filler = parts.find((q) => q.role === 'filler');
  const panel = parts.find((q) => q.standing);
  const group = (id) => paint.groups.find((g) => g.id === id);
  assertApprox(group('fronts').areaM2, faceAndEdges(door, 2));
  assertApprox(group('fillers').areaM2, faceAndEdges(filler, 1));
  assertApprox(group('panels').areaM2, faceAndEdges(panel, 2));
  assert(!group('sides') && !group('plinth'), 'case and toe kicks not painted by default');
  assertApprox(paint.areaFt2, paint.areaM2 * FT2_PER_M2);
  // Top coat: 3 coats at 350 ft² a gallon, bought whole.
  const top = paint.products.find((pr) => pr.name === 'Top coat');
  assertApprox(top.qty, (paint.areaFt2 * 3) / 350);
  assertEq(top.buy, Math.ceil(top.qty));
  assertApprox(top.cost, top.buy * 131);
  assertApprox(paint.cost, paint.products.reduce((n, pr) => n + pr.cost, 0));
  // In the job's material cost (no sheets priced here), and off when paint is.
  const sheets = new Map(c.library.map((m) => [m.id, 0]));
  assertApprox(supplies(cabs, c, sheets, []).paint.cost, paint.cost);
  assert(paint.cost > 0, 'paint is priced');
  c.paint.enabled = false;
  assertEq(paintNeeded(cabs, c).products.length, 0);
});

test('corner wall: 600 × 600 with a door on the 45° diagonal', () => {
  const p = emptyProject();
  const c = p.construction;
  addWall(p);
  const corner = newCorner('wall', 0, c);
  addCabinet(p, corner);
  const built = buildAll(p);
  assert(!built[0].error, built[0].error);
  const door = built[0].cabinet.parts.find((q) => q.role === 'door');
  const diagonal = (600 - corner.depth) * Math.SQRT2;
  assertApprox(door.width, diagonal - 2 * c.reveals.side);
  assertApprox(cornerDoors(corner, c).door, door.width);
  assertApprox(Math.abs(door.frame.u[0]), Math.SQRT1_2);
  const bottom = built[0].cabinet.parts.find((q) => q.role === 'bottom');
  assertEq(bottom.outline.length, 6);
});

test('supply list prices hinges, plates and slides', () => {
  const c = defaultConstruction();
  c.hinge.cost = 4.25;
  c.hinge.plateCost = 0.9;
  c.slide.cost = 32;
  const cabs = [buildCabinet(newCabinet('base', 1), c), buildCabinet(drawerBase(2, 3), c)];
  const s = supplies(cabs, c, new Map([[1, 2], [2, 1], [3, 1]]));
  const row = (item) => s.hardware.find((r) => r.item === item);
  assertApprox(row('Hinge').cost, row('Hinge').qty * 4.25);
  assertApprox(row('Hinge mounting plate').cost, row('Hinge mounting plate').qty * 0.9);
  assertApprox(row('Drawer slides').cost, 3 * 32);
  assertEq(row('Shelf pins').cost, 0);
  assertApprox(s.hardwareCost, row('Hinge').cost + row('Hinge mounting plate').cost + 96);
  assertApprox(s.totalCost, s.materialCost + s.hardwareCost);
  const csv = suppliesCsv(s);
  assert(csv.includes(',3,pairs,32.00,96.00'), 'csv slide cost');
  assert(csv.includes(`Total,Job,,,,,${s.totalCost.toFixed(2)}`), 'csv job total');
});

test('SolidCraft export keeps parts, dadoes and drilling', () => {
  const p = newProject();
  p.cabinets = [{ ...newCabinet('base', 1), x: 0 }, { ...drawerBase(2, 3), x: 600 }];
  p.construction.back = { type: 'dado', depth: 6 };
  const built = buildAll(p);
  const d = solidcraftDesign(p, built);
  assertEq(d.format, 'solidcraft/28');

  // Ids are unique across features, components, occurrences and folders.
  const ids = [...d.features, ...d.components, ...d.occurrences, ...d.timeline_groups].map((x) => x.id);
  assertEq(new Set(ids).size, ids.length, 'unique ids');
  assert(d.next_id > Math.max(...ids), 'next_id');

  // One component per cabinet, one per part inside it, each placed once.
  const cabs = d.components.filter((c) => c.parent === 0);
  assertEq(cabs.map((c) => c.name), ['Base 1', 'Drawer base 2']);
  const partsOf = (cab) => d.components.filter((c) => c.parent === cab.id);
  assertEq(partsOf(cabs[0]).length, built[0].cabinet.parts.length);
  for (const comp of d.components) assertEq(d.occurrences.filter((o) => o.component === comp.id).length, 1, comp.name);
  const names = partsOf(cabs[1]).map((c) => c.name);
  assertEq(new Set(names).size, names.length, 'part names unique in a cabinet');
  assert(names.includes('Drawer front 3'), 'numbered duplicates');

  // Bodies: one box each, unique names, with an appearance.
  const bodies = d.features.filter((f) => f.type === 'box' && f.operation === 'new_body').map((f) => f.body_names[0]);
  assertEq(new Set(bodies).size, bodies.length, 'unique bodies');
  assertEq(Object.keys(d.appearances.bodies).sort(), [...bodies].sort());

  // Every cut and hole changes only its own part's body, in its own component.
  for (const f of d.features.filter((f) => f.operation === 'cut' || f.type === 'hole')) {
    assertEq(f.participants.length, 1, f.name);
    const own = d.features.find((b) => b.body_names?.[0] === f.participants[0]);
    assertEq(own.component, f.component, f.name);
  }
  assertEq(d.features.filter((f) => f.name.startsWith('Dado')).length, 2, 'base back dadoes in the bottom (base has no top)');

  // Every bore is drilled: hole points match the part's bores.
  const holes = d.features.filter((f) => f.type === 'hole');
  const drilled = holes.reduce((n, f) => n + f.points.ids.length, 0);
  const expected = built.flatMap((b) => b.cabinet.parts).reduce((n, part) => n + bores(part).length, 0);
  assertEq(drilled, expected, 'all bores');

  // Hinge cups: on the door's back face, drilled into the door toward the front (-Y).
  const cups = holes.find((f) => f.name.startsWith('Hinge cups'));
  assertEq(cups.direction, [0, -1, 0]);
  assertEq(cups.diameter, '35');
  const sketch = d.features.find((f) => f.id === cups.points.sketch);
  const { origin, x_dir, y_dir } = sketch.plane.plane;
  const door = built[0].cabinet.parts.find((q) => q.role === 'door');
  for (const id of cups.points.ids) {
    const pt = sketch.sketch.points.find((q) => q.id === id).pos;
    const w = origin.map((o, i) => o + pt[0] * x_dir[i] + pt[1] * y_dir[i]);
    assertApprox(w[1], -door.bbox.min[2]); // back face of the door
    assertApprox(w[0], door.bbox.min[0] + 22); // cup centre from the hinge (left) edge
  }
  // Left side system holes go -X into the side from its inside face.
  const sys = holes.find((f) => f.name.startsWith('System holes'));
  assertEq(sys.direction, [-1, 0, 0]);
  assertApprox(sys.position[0], caseT(p.construction));

  // Part details for the bill of materials.
  const leftSide = partsOf(cabs[0]).find((c) => c.name === 'Left side');
  assert(leftSide.properties.Material.includes('White melamine'), 'material');
  assert(leftSide.properties.Drilling.includes('System holes'), 'drilling summary');

  // Folders are contiguous runs of features.
  const pos = new Map(d.features.map((f, i) => [f.id, i]));
  for (const g of d.timeline_groups.filter((g) => g.features.length)) {
    const at = g.features.map((f) => pos.get(f)).sort((a, b) => a - b);
    assertEq(at[at.length - 1] - at[0] + 1, at.length, g.name);
  }
});

test('CNC parts lie drilled face up, holes from the cut edges', () => {
  const [spec, c] = base();
  const cab = buildCabinet(spec, c);
  const left = tablePart(c, part(cab, 'leftSide'));
  const right = tablePart(c, part(cab, 'rightSide'));
  const band = bandThickness(c, part(cab, 'leftSide'));
  // The side's front edge (L1) is banded: the cut is one band narrower.
  assertApprox(left.width, part(cab, 'leftSide').width - band);
  const plates = (t) => t.holes.filter((h) => h.purpose === 'hingePlate');
  // Right side: front edge at y = 0; left side seen from inside is its mirror image.
  for (const h of plates(right)) assertApprox(h.y, c.system.frontSetback - band);
  // Single door hinged left: only the left side has plate holes.
  assertEq(plates(right).length, 0, 'right side has no plates');
  for (const h of plates(left)) assertApprox(left.width - h.y, c.system.frontSetback - band);
  // Mirror images: the holes match with y flipped (on the left side the hinge
  // plates take four of the front line's system holes).
  const key = (t, flip) => t.holes.map((h) => `${h.x.toFixed(1)},${(flip ? t.width - h.y : h.y).toFixed(1)}`).sort().join(' ');
  assertEq(key(left, true), key(right, false));
});

test('CNC program drills, cuts out with lead-in and tabs, never into a part', () => {
  const p = newProject();
  p.cabinets = [{ ...newCabinet('base', 1), x: 0 }];
  const built = buildAll(p);
  const cab = built[0].cabinet;
  const want = ['leftSide', 'rightSide', 'door'].map((role) => `${p.cabinets[0].id}:${cab.parts.findIndex((q) => q.role === role)}`);
  const cfg = p.construction.cnc;
  const groups = cncGroups(p, built, new Set(want));
  assertEq(groups.map((g) => g.items.length).reduce((a, b) => a + b, 0), 3);
  const R = cfg.toolDiameter / 2;
  for (const g of groups) {
    const nested = nestGroup(g, { ...cncNesting(cfg), effort: 'quick' });
    assertEq(nested.unplaced.length, 0, 'fits the stock');
    const T = g.material.thickness;
    for (const sheet of nested.sheets) {
      const prog = sheetProgram(sheet, cfg, T);
      const moves = prog.moves.filter((m) => m.g !== undefined);
      assert(Math.min(...moves.map((m) => m.z)) >= -(T + cfg.cutThrough) - 1e-9, 'no deeper than the cut-through');
      // Every bore lands inside its part.
      for (const q of sheet.parts) {
        for (const hl of q.holes) {
          const [x, y] = onStock(q, hl.x, hl.y);
          assert(x > q.x && x < q.x + q.sizeX && y > q.y && y < q.y + q.sizeY, `${q.name} hole on its part`);
        }
      }
      // Cut-out moves below the surface keep the tool out of every part.
      const cutStart = prog.moves.findIndex((m) => m.comment?.startsWith('Cut out'));
      for (const m of prog.moves.slice(cutStart).filter((m) => m.g >= 1 && m.z < 0)) {
        for (const q of sheet.parts) {
          const dx = Math.max(q.x - m.x, 0, m.x - (q.x + q.sizeX));
          const dy = Math.max(q.y - m.y, 0, m.y - (q.y + q.sizeY));
          assert(Math.hypot(dx, dy) >= R - 1e-6, `tool at ${m.x}, ${m.y} cuts into ${q.name}`);
        }
      }
      const code = gcode(prog, cfg, ['test']);
      assert(code.includes('G21 G90 G17 G94') && code.includes(`M3 S${cfg.rpm}`) && code.trim().endsWith('M30'), 'GRBL frame');
      assert(!/[^\x00-\x7e]/.test(code), 'ASCII only');
      if (sheet.parts.some((q) => q.holes.some((hl) => hl.diameter > cfg.toolDiameter))) {
        // Hinge cups: helix of radius (35 - 5) / 2, clockwise (climb) inside the hole.
        assert(moves.some((m) => m.g === 2 && approx(Math.hypot(m.i, m.j), 15)), 'cup helix');
      }
      if (sheet.parts.some((q) => q.holes.some((hl) => hl.diameter === cfg.toolDiameter))) {
        assert(moves.some((m) => m.g === 1 && approx(m.z, -c_depth(sheet))), 'system holes plunged to depth');
      }
      // Tabs: the last pass lifts to the tab top.
      assert(moves.some((m) => approx(m.z, -(T - cfg.tabHeight))), 'tabs');
      // Climb outside: corners counter-clockwise; lead-in/out clockwise arcs of the lead radius.
      assert(moves.some((m) => m.g === 3 && approx(Math.hypot(m.i, m.j), R)), 'corner arcs');
      assert(moves.some((m) => m.g === 2 && approx(Math.hypot(m.i, m.j), cfg.leadInRadius)), 'lead-in arc');
    }
  }
  // Operations off: nothing to cut.
  const off = { ...cfg, drill: false, profile: false };
  const g0 = cncGroups(p, built, new Set(want))[0];
  assertEq(sheetProgram(nestGroup(g0, { ...cncNesting(off), effort: 'quick' }).sheets[0], off, 16).moves.length, 0);
});
test('CNC cut-out ramps in, rises over triangle tabs, and still cuts every side through', () => {
  const p = newProject();
  p.cabinets = [{ ...newCabinet('base', 1), x: 0 }];
  const built = buildAll(p);
  const cab = built[0].cabinet;
  const side = `${p.cabinets[0].id}:${cab.parts.findIndex((q) => q.role === 'leftSide')}`;
  const g = cncGroups(p, built, new Set([side]))[0];
  const T = g.material.thickness;
  const run = (over) => {
    const cfg = { ...p.construction.cnc, drill: false, ...over };
    const sheet = nestGroup(g, { ...cncNesting(cfg), effort: 'quick' }).sheets[0];
    return { cfg, sheet, moves: sheetProgram(sheet, cfg, T).moves.filter((m) => m.g !== undefined) };
  };
  const { cfg, sheet, moves } = run({});
  const full = -(T + cfg.cutThrough);
  const tabTop = -(T - cfg.tabHeight);
  // Ramping: no feed move goes down without moving across, except onto the surface.
  let at = { x: 0, y: 0, z: cfg.safeZ };
  for (const m of moves) {
    const across = Math.hypot(m.x - at.x, m.y - at.y);
    if (m.g >= 1 && m.z < at.z - 1e-9 && m.z < -1e-9) {
      assert(across > 1e-6, `plunge to ${m.z} at ${m.x}, ${m.y}`);
      // No steeper than the ramp (pass depth over ramp length), or a tab's slope.
      const slope = (at.z - m.z) / Math.max(across, 1e-9);
      const tabSlope = (cfg.tabHeight + cfg.cutThrough) / ((cfg.tabLength + cfg.toolDiameter) / 2);
      assert(slope <= Math.max(cfg.passDepth / cfg.rampLength, tabSlope) + 1e-6, `slope ${slope}`);
    }
    at = m;
  }
  assert(moves.some((m) => approx(m.z, tabTop)), 'tab peaks');
  // The lead-in arc stays within its radius of the path: the tool never reaches past
  // the part spacing it needs.
  const q = sheet.parts[0];
  for (const m of moves.filter((m) => m.z <= 0)) {
    const dx = Math.max(q.x - m.x, 0, m.x - (q.x + q.sizeX));
    const dy = Math.max(q.y - m.y, 0, m.y - (q.y + q.sizeY));
    assert(Math.hypot(dx, dy) <= cfg.toolDiameter / 2 + cfg.leadInRadius + 1e-6, 'lead-in reach');
  }
  // At full depth the tool goes all the way round apart from the tabs: the four
  // sides' full-depth travel adds up to the path length less the tab stretches.
  let cut = 0;
  at = { x: 0, y: 0, z: cfg.safeZ };
  for (const m of moves) {
    if (m.g >= 1 && approx(m.z, full) && approx(at.z, full)) cut += m.g === 1 ? Math.hypot(m.x - at.x, m.y - at.y) : (Math.PI / 2) * Math.hypot(m.i, m.j);
    at = m;
  }
  const R = cfg.toolDiameter / 2;
  const path = 2 * (q.sizeX + q.sizeY) + 2 * Math.PI * R;
  const tabs = moves.filter((m) => approx(m.z, tabTop)).length; // one peak per tab on the last pass
  assert(cut >= path - tabs * (cfg.tabLength + cfg.toolDiameter) - 1e-6, `full-depth cut ${cut} of ${path}`);
  // Square tabs and plunged entry still work.
  const sq = run({ tabShape: 'square', ramp: false, leadIn: false }).moves;
  assert(sq.some((m) => m.g === 1 && approx(m.z, tabTop)), 'square tab lift');
  assert(sq.some((m, k) => k > 0 && m.g === 1 && approx(m.z, -cfg.passDepth) && m.x === sq[k - 1].x && m.y === sq[k - 1].y), 'plunged entry');
});
test('CNC peck drilling: full retract or chip break', () => {
  const p = newProject();
  p.cabinets = [{ ...newCabinet('base', 1), x: 0 }];
  const built = buildAll(p);
  const cab = built[0].cabinet;
  const side = `${p.cabinets[0].id}:${cab.parts.findIndex((q) => q.role === 'rightSide')}`;
  const g = cncGroups(p, built, new Set([side]))[0];
  const T = g.material.thickness;
  const base = { ...p.construction.cnc, profile: false };
  const sheet = nestGroup(g, { ...cncNesting(base), effort: 'quick' }).sheets[0];
  const holes = sheet.parts[0].holes.length;
  const depth = sheet.parts[0].holes[0].depth; // 12
  const drill = (over) => sheetProgram(sheet, { ...base, ...over }, T).moves.filter((m) => m.g !== undefined);
  const plunges = (moves) => moves.filter((m, k) => k > 0 && m.g === 1 && m.z < moves[k - 1].z);

  // Off: one plunge per hole, to depth.
  const one = drill({ peckDrill: false });
  assertEq(plunges(one).length, holes);
  assert(plunges(one).every((m) => approx(m.z, -depth)));

  // Full retract, 5 mm pecks: 5, 10, 12; out to clearance between, back to 0.5 above the last peck.
  const full = drill({ peckDrill: true, peck: 5, peckRetract: 'full' });
  assertEq(plunges(full).length, holes * 3);
  assertEq(plunges(full).slice(0, 3).map((m) => m.z), [-5, -10, -12]);
  assert(full.filter((m) => m.g === 0 && approx(m.z, -4.5)).length === holes, 'back down to just above the first peck');
  assert(full.filter((m) => m.g === 0 && approx(m.z, base.clearZ)).length >= holes * 3, 'out of the hole after each peck');

  // Chip break: backs off 0.5 only, never leaves the hole until done.
  const chip = drill({ peckDrill: true, peck: 5, peckRetract: 'chip', chipBreak: 0.5 });
  assertEq(plunges(chip).length, holes * 3);
  const firstHole = chip.slice(chip.findIndex((m) => approx(m.z, -5)), chip.findIndex((m) => approx(m.z, -12)) + 1);
  assert(firstHole.every((m) => m.z < 0), 'stays in the hole');
  assert(chip.some((m) => m.g === 0 && approx(m.z, -4.5)) && chip.some((m) => m.g === 0 && approx(m.z, -9.5)), 'backs off 0.5');
  // Pecking takes longer than one plunge.
  assert(sheetProgram(sheet, { ...base, peckDrill: true, peck: 5 }, T).minutes > sheetProgram(sheet, base, T).minutes, 'time');
});
/** Signed distance from a point to a polygon's boundary: negative inside. */
function polyDistance(poly, [x, y]) {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[j], poly[i]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    d = Math.min(d, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? -d : d;
}

test('integrated toe kick cover: front material over the board and notches, joined like a filler', () => {
  const p = emptyProject();
  const c = p.construction;
  c.plinth = 'sides';
  addCabinet(p, newCabinet('base', 0, c));
  addCabinet(p, newFiller('base', 0, c));
  addCabinet(p, newCabinet('base', 0, c));
  const cab = buildCabinet(p.cabinets[0], c);
  const cover = cab.parts.find((q) => q.role === 'toeKickCover');
  const kick = part(cab, 'toeKick');
  const ft = thickness(c, 'front');
  assertEq(cover.material, 'front');
  assertApprox(cover.length, 600);
  assertApprox(cover.width, c.toeKickHeight);
  assertApprox(cover.thickness, ft);
  // Against the board's face, over the sides' notches (full width).
  assertApprox(cover.bbox.min[2], kick.bbox.min[2] + kick.bbox.size[2]);
  assertApprox(cover.bbox.min[0], 0);
  for (const side of [part(cab, 'leftSide'), part(cab, 'rightSide')]) {
    for (const a of partSolids(side)) assert(!boxIntersection(a, cover.bbox), 'cover clear of the side');
  }
  // One board along the run, under the filler too.
  const built = buildAll(p);
  const covers = built.flatMap((b) => b.cabinet.parts.filter((q) => q.role === 'toeKickCover'));
  assertEq(covers.length, 1);
  assertApprox(covers[0].length, 600 + DEFAULT_FILLER_WIDTH + 600);
  // Banded and painted like a filler; off when turned off.
  assertEq(bandGroup('toeKickCover'), 'filler');
  c.toeKickCover = false;
  assert(!buildCabinet(p.cabinets[0], c).parts.some((q) => q.role === 'toeKickCover'), 'no cover');
});

test('toe kick in the sides: sides to the floor, notched, board between them', () => {
  const [spec, c] = base();
  const plain = buildCabinet(spec, c);
  c.plinth = 'sides';
  const cab = buildCabinet(spec, c);
  const t = caseT(c);
  const toe = c.toeKickHeight;
  const left = part(cab, 'leftSide');
  // Sides from the floor to the top, one toe height longer.
  assertEq(left.bbox.min[1], 0);
  assertApprox(left.length, spec.height);
  assertApprox(left.length, part(plain, 'leftSide').length + toe);
  // The notch at the front bottom, through, toe high and setback deep.
  const notch = left.ops.find((op) => op.type === 'pocket');
  assertEq([notch.x, notch.y, notch.length, notch.width, notch.depth], [0, 0, toe, c.toeKickSetback, t]);
  assertEq(left.cuts.length, 1);
  // The case is where it was: same bottom, same holes, moved up the side by the toe height.
  assertApprox(part(cab, 'bottom').bbox.min[1], part(plain, 'bottom').bbox.min[1]);
  const holes = (cab0) => bores(part(cab0, 'leftSide')).map((b) => `${b.purpose}:${b.x.toFixed(1)},${b.y.toFixed(1)}`).sort();
  assertEq(holes(cab), bores(part(plain, 'leftSide')).map((b) => `${b.purpose}:${(b.x + toe).toFixed(1)},${b.y.toFixed(1)}`).sort());
  // One toe-kick board between the sides, its face at the back of the notch, and its cover; no plinth frame.
  const kicks = cab.parts.filter((q) => isPlinth(q.role) && q.role !== 'toeKickCover');
  assertEq(kicks.map((q) => q.name), ['Toe kick']);
  const kick = kicks[0];
  assertApprox(kick.length, spec.width - 2 * t);
  assertApprox(kick.bbox.min[0], t);
  assertApprox(kick.bbox.min[2] + kick.bbox.size[2], spec.depth - c.toeKickSetback);
  // Nothing overlaps: the board sits in the notches, clear of the sides' solids.
  for (const side of [left, part(cab, 'rightSide')]) {
    for (const a of partSolids(side)) assert(!boxIntersection(a, kick.bbox), 'kick clear of the side');
  }
  // Hinge cups still meet the plates.
  const door = part(cab, 'door');
  const cups = bores(door).filter((b) => b.purpose === 'hingeCup').map((b) => b.x + door.bbox.min[1] - left.bbox.min[1]);
  for (const x of cups) assertEq(bores(left).filter((b) => b.purpose === 'hingePlate' && approx(Math.abs(b.x - x), 16)).length, 2);
  // Wall cabinets are unchanged.
  const wall = buildCabinet(newCabinet('wall', 2), c);
  assert(part(wall, 'leftSide').ops.every((op) => op.type !== 'pocket'), 'wall sides not notched');
  // The CNC cuts the notched side around its notch.
  assertEq(tablePart(c, left).outline.length, 6);
});

test('notched outline: a corner notch leaves six corners, counter-clockwise', () => {
  const poly = notchedOutline(700, 600, [{ x0: 0, y0: 0, x1: 120, y1: 55 }]);
  assertEq(poly.length, 6);
  const area = poly.reduce((n, p, i) => n + (p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1]) / 2, 0);
  assertApprox(area, 700 * 600 - 120 * 55); // positive: counter-clockwise
  assertEq(notchedOutline(700, 600, [{ x0: 300, y0: 0, x1: 400, y1: 50 }]).length, 8, 'a slot from one edge');
});

test('CNC cuts end panels around their toe-kick notch and clears the back rabbet', () => {
  const p = newProject();
  p.construction.back = { type: 'dado', depth: 6 };
  p.cabinets = [{ ...newCabinet('base', 1), x: 0, endPanels: { left: true, right: false } }];
  const built = buildAll(p);
  const cab = built[0].cabinet;
  const key = (role) => `${p.cabinets[0].id}:${cab.parts.findIndex((q) => q.role === role)}`;
  const cfg = p.construction.cnc;
  const R = cfg.toolDiameter / 2;
  for (const g of cncGroups(p, built, new Set([key('endPanel'), key('bottom')]))) {
    const T = g.material.thickness;
    const sheet = nestGroup(g, { ...cncNesting(cfg), effort: 'quick' }).sheets[0];
    const prog = sheetProgram(sheet, cfg, T);
    const q = sheet.parts[0];
    if (q.name === 'Left end panel') {
      const poly = stockOutline(q);
      assertEq(poly.length, 6, 'notched outline');
      const cut = prog.moves.slice(prog.moves.findIndex((m) => m.comment?.startsWith('Cut out'))).filter((m) => m.g >= 1 && m.z < 0);
      for (const m of cut) assert(polyDistance(poly, [m.x, m.y]) >= R - 1e-6, `tool at ${m.x}, ${m.y} cuts into the panel`);
      // The cut goes into the notch, at full depth.
      const full = -(T + cfg.cutThrough);
      const inNotch = cut.filter((m) => approx(m.z, full) && polyDistance(poly, [m.x, m.y]) > 0 && polyDistance([[q.x, q.y], [q.x + q.sizeX, q.y], [q.x + q.sizeX, q.y + q.sizeY], [q.x, q.y + q.sizeY]], [m.x, m.y]) < 0);
      assert(inNotch.length >= 2, 'tool runs inside the notch');
      // Inside corner: the path meets in a point a radius from both sides.
      assert(inNotch.some((m) => approx(polyDistance(poly, [m.x, m.y]), R)), 'inside corner');
    } else {
      // Bottom: the rabbet along its back edge, cleared to its depth, nowhere else.
      assertEq(q.pockets.length, 1);
      const pk = stockRect(q, q.pockets[0]);
      const from = prog.moves.findIndex((m) => m.comment?.startsWith('Dado'));
      const to = prog.moves.findIndex((m, k) => k > from && m.comment !== undefined);
      const moves = prog.moves.slice(from, to).filter((m) => m.g >= 1 && m.z < 0);
      assert(moves.some((m) => approx(m.z, -6)), 'full depth');
      assert(Math.min(...moves.map((m) => m.z)) >= -6 - 1e-9, 'no deeper');
      const part = { x0: q.x, y0: q.y, x1: q.x + q.sizeX, y1: q.y + q.sizeY };
      for (const m of moves) {
        // Closed sides: the tool stays a radius inside; open ones (on the part's edge) it may pass.
        if (pk.x0 > part.x0 + 0.05) assert(m.x - R >= pk.x0 - 1e-6, 'x0 wall');
        if (pk.x1 < part.x1 - 0.05) assert(m.x + R <= pk.x1 + 1e-6, 'x1 wall');
        if (pk.y0 > part.y0 + 0.05) assert(m.y - R >= pk.y0 - 1e-6, `y0 wall ${m.y}`);
        if (pk.y1 < part.y1 - 0.05) assert(m.y + R <= pk.y1 + 1e-6, 'y1 wall');
      }
      // Passes no more than the stepover apart, the outermost on the walls.
      const alongX = pk.x1 - pk.x0 >= pk.y1 - pk.y0;
      const across = [...new Set(moves.filter((m) => approx(m.z, -6)).map((m) => (alongX ? m.y : m.x).toFixed(3)))].map(Number).sort((a, b) => a - b);
      for (let k = 1; k < across.length; k++) assert(across[k] - across[k - 1] <= (cfg.toolDiameter * cfg.stepover) / 100 + 1e-6, 'stepover');
      assertApprox(across[0] - R, alongX ? pk.y0 : pk.x0);
      assertApprox(across[across.length - 1] + R, alongX ? pk.y1 : pk.x1);
    }
  }
});
const c_depth = (sheet) => sheet.parts.flatMap((q) => q.holes).find((hl) => hl.purpose === 'system').depth;

test('edge banding reduces cut size', () => {
  const [spec, c] = base();
  const cab = buildCabinet(spec, c);
  const door = part(cab, 'door');
  let [l, w] = cutSize(door, c.edgeBandThickness);
  assertApprox(l, door.length - 2);
  assertApprox(w, door.width - 2);
  const side = part(cab, 'leftSide');
  [l, w] = cutSize(side, c.edgeBandThickness);
  assertApprox(l, side.length);
  assertApprox(w, side.width - 1);
});

test('cut list groups identical parts', () => {
  const p = newProject();
  const list = projectCutList(p);
  const sides = list.rows
    .filter((r) => r.name.endsWith('side') && !r.name.startsWith('Drawer'))
    .reduce((s, r) => s + r.qty, 0);
  assertEq(sides, 2 * p.cabinets.length);
  // The two identical wall cabinets share rows.
  const wallTop = list.rows.find((r) => r.name === 'Top' && r.cabinets.length === 2);
  assert(wallTop && wallTop.qty === 2);
  assert(list.edgeBandM > 0);
  assertEq(cutListCsv(list).trim().split('\n').length, list.rows.length + 1);
});

test('default project layout', () => {
  const p = newProject();
  assertEq(
    p.cabinets.map((c) => [c.kind, c.x]),
    [
      ['base', 0],
      ['base', 600],
      ['wall', 0],
      ['wall', 600],
      ['tall', 1200],
    ],
  );
  assert(buildAll(p).every((b) => b.cabinet));
});

test('project survives a JSON round trip', () => {
  const p = newProject();
  const copy = JSON.parse(JSON.stringify(p));
  assertEq(projectCutList(copy), projectCutList(p));
});

test('resizing slides the run', () => {
  const p = newProject();
  // Base 2 grows by 300: the tall shifts, walls do not.
  resizeCabinet(p, 1, 900);
  assertEq(
    p.cabinets.map((c) => c.x),
    [0, 600, 0, 600, 1500],
  );
  // Growing a wall cabinet moves the tall too, but not the bases.
  resizeCabinet(p, 2, 700);
  assertEq(
    p.cabinets.map((c) => c.x),
    [0, 600, 0, 700, 1600],
  );
});

test('shop standard base', () => {
  // 16mm melamine, box 770 high x 610 deep on a 110 x 550 plinth (60 overhang).
  const [spec, c] = base();
  const cab = buildCabinet(spec, c);
  assertApprox(caseT(c), 16);
  const side = part(cab, 'leftSide');
  assertApprox(side.length, 770);
  assertApprox(side.width, 610);
  const front = part(cab, 'toeKick');
  const rear = part(cab, 'plinthRear');
  assertApprox(front.width, 110);
  assertApprox(boxMax(front.bbox)[2] - rear.bbox.min[2], 550, 'plinth is 550 deep');
  assertApprox(spec.depth - boxMax(front.bbox)[2], 60, 'case overhangs 60');
  assertEq(count(cab, 'plinthEnd'), 2);
  assertApprox(part(cab, 'plinthEnd').length, 550 - 2 * 16);
});

test('butt back stands on bottom', () => {
  const [spec, c] = base();
  const cab = buildCabinet(spec, c);
  const t = caseT(c);
  assertEq(c.back, { type: 'butt' });
  const back = part(cab, 'back');
  assertApprox(back.bbox.min[0], t);
  assertApprox(back.bbox.min[2], 0);
  assertApprox(back.width, spec.width - 2 * t);
  assertApprox(back.thickness, 16);
  assertApprox(back.bbox.min[1], c.toeKickHeight + t);
  assertApprox(back.length, 754);
  assertEq(back.ops.length, 0);
  assertApprox(part(cab, 'shelf').bbox.min[2], 16);
});

test('back in dado across bottom', () => {
  const [spec, c] = base();
  c.back = { type: 'dado', depth: 6 };
  const cab = buildCabinet(spec, c);
  const t = caseT(c);
  const back = part(cab, 'back');
  assertApprox(back.bbox.min[1], c.toeKickHeight + t - 6);
  assertApprox(back.length, 760);
  const bottom = part(cab, 'bottom');
  const d = pockets(bottom)[0];
  assertEq([d.x, d.y, d.length, d.width, d.depth], [0, bottom.width - 16, bottom.length, 16, 6]);
});

test('back dado goes into both bottom and top on a wall cabinet', () => {
  const spec = newCabinet('wall', 1);
  const c = defaultConstruction();
  c.back = { type: 'dado', depth: 6 };
  const cab = buildCabinet(spec, c);
  const t = caseT(c);
  const back = part(cab, 'back');
  assertApprox(back.bbox.min[1], t - 6);
  assertApprox(boxMax(back.bbox)[1], spec.height - t + 6);
  for (const role of ['bottom', 'top']) {
    const p = part(cab, role);
    const d = pockets(p)[0];
    assert(d, `${role} has a dado`);
    assertEq([d.x, d.y, d.length, d.width, d.depth], [0, p.width - t, p.length, t, 6]);
  }
});

test('back dado on a base: bottom only, butt joint at the stretchers', () => {
  const [spec, c] = base();
  c.back = { type: 'dado', depth: 6 };
  const cab = buildCabinet(spec, c);
  assertEq(pockets(part(cab, 'bottom')).length, 1);
  for (const role of ['frontStretcher', 'rearStretcher']) assertEq(pockets(part(cab, role)).length, 0);
  assertApprox(boxMax(part(cab, 'back').bbox)[1], spec.height);
});

test('wall back stops under top', () => {
  const spec = newCabinet('wall', 1);
  const c = defaultConstruction();
  const back = part(buildCabinet(spec, c), 'back');
  assertApprox(boxMax(back.bbox)[1], spec.height - caseT(c));
  assertApprox(back.bbox.min[1], caseT(c));
});

test('materials come from the library', () => {
  const [spec, c] = base();
  const cab = buildCabinet(spec, c);
  assertApprox(thickness(c, 'front'), 19);
  const door = part(cab, 'door');
  assertEq(door.material, 'front');
  assertApprox(door.thickness, 19);
  const back = part(cab, 'back');
  assertEq(back.material, 'case');
  assertApprox(back.thickness, caseT(c));
});

test('changing a library entry reflows parts', () => {
  const [spec, c] = base();
  c.library.find((m) => m.id === c.materials.case).thickness = 18;
  const cab = buildCabinet(spec, c);
  assertApprox(part(cab, 'bottom').length, spec.width - 36);
  assertApprox(part(cab, 'back').thickness, 18);
  const id = nextMaterialId(c);
  c.library.push(newMaterial(id, 'Black melamine', 'Melamine', 19, '#222222'));
  c.materials.case = id;
  const list = cutList([buildCabinet(spec, c)], c);
  assert(list.rows.some((r) => r.name === 'Left side' && r.material === 'Black melamine'));
});

test('drawer bottom matches drawer box', () => {
  const c = defaultConstruction();
  const cab = buildCabinet(drawerBase(1, 3), c);
  const side = part(cab, 'drawerSide');
  const bottom = part(cab, 'drawerBottom');
  assertEq(bottom.material, 'drawerBox');
  assertApprox(bottom.thickness, side.thickness);
  assertApprox(bottom.thickness, 12);
});

test('missing library material is an error', () => {
  const [spec, c] = base();
  c.library = c.library.filter((m) => m.id !== c.materials.front);
  let message = '';
  try {
    buildCabinet(spec, c);
  } catch (e) {
    message = e.message;
  }
  assert(message.includes('Fronts'), message);
});

test('doors over drawer: a drawer at the bottom, doors above, shelves only above the drawer', () => {
  const c = defaultConstruction();
  // A tall upper standing on the countertop.
  const spec = { ...newCabinet('wall', 1, c), height: 1250, elevation: 910, shelves: 2, fronts: { type: 'doorsOverDrawer', drawerHeight: 150, doorCount: 0 } };
  const cab = buildCabinet(spec, c);
  const r = c.reveals;
  const front = part(cab, 'drawerFront');
  const door = part(cab, 'door');
  assertApprox(front.bbox.min[1], r.bottom);
  assertApprox(front.bbox.size[1], 150);
  assertApprox(door.bbox.min[1], r.bottom + 150 + r.gap);
  assertApprox(door.bbox.min[1] + door.bbox.size[1], spec.height - r.top);
  assert(front.slide, 'drawer on slides');
  for (const sh of cab.parts.filter((q) => q.role === 'shelf')) assert(sh.bbox.min[1] >= door.bbox.min[1], 'shelf above the drawer');
  // In drawer units too.
  spec.fronts = { type: 'doorsOverDrawer', doorCount: 0, units: 5 };
  assertApprox(part(buildCabinet(spec, c), 'drawerFront').bbox.size[1], unitFrontHeight(c, 5));
});

test('front stack: drawer, drawer, door, drawer with a stretcher, a full panel and fixed shelves', () => {
  const c = defaultConstruction();
  const t = caseT(c);
  const r = c.reveals;
  const spec = { ...newCabinet('tall', 1, c) };
  spec.fronts = {
    type: 'stack',
    sections: [
      { ...newSection('drawer'), units: 5, below: 'stretcher' },
      { ...newSection('drawer'), units: 5, below: 'panel' },
      { ...newSection('door'), shelves: 2, fixedShelves: 1, below: 'stretcher' },
      { ...newSection('drawer'), height: 250 },
    ],
  };
  const cab = buildCabinet(spec, c);
  const byTop = (role) => cab.parts.filter((p) => p.role === role).sort((a, b) => b.bbox.min[1] - a.bbox.min[1]);
  const drawers = byTop('drawerFront');
  const door = part(cab, 'door');
  assertEq(drawers.length, 3);
  // Top down: two 5-unit drawers, the door filling, a 250 drawer at the bottom.
  assertApprox(boxMax(drawers[0].bbox)[1], spec.height - r.top);
  assertApprox(drawers[1].bbox.size[1], unitFrontHeight(c, 5));
  assertApprox(boxMax(door.bbox)[1], drawers[1].bbox.min[1] - r.gap);
  assertApprox(drawers[2].bbox.min[1], c.toeKickHeight + r.bottom);
  assertApprox(drawers[2].bbox.size[1], 250);
  assertApprox(door.bbox.min[1], 250 + r.gap + c.toeKickHeight + r.bottom);
  // Dividers centred on the gaps: a stretcher, a full panel, a stretcher.
  const stretchers = cab.parts.filter((p) => p.name === 'Stretcher').sort((a, b) => b.bbox.min[1] - a.bbox.min[1]);
  assertEq(stretchers.length, 2);
  assertApprox(stretchers[0].bbox.min[1] + t / 2, drawers[0].bbox.min[1] - r.gap / 2);
  assertApprox(stretchers[0].bbox.size[2], c.stretcherWidth);
  const panel = cab.parts.find((p) => p.name === 'Divider');
  assertApprox(panel.bbox.min[1] + t / 2, drawers[1].bbox.min[1] - r.gap / 2);
  assertApprox(panel.bbox.size[2], spec.depth - t);
  // Drawers over a divider ride above it; the bottom one stays under the stretcher over it.
  const boxes = byTop('drawerSide');
  assert(boxes[0].bbox.min[1] >= boxMax(stretchers[0].bbox)[1], 'drawer box over the stretcher');
  assert(boxes[2].bbox.min[1] >= boxMax(panel.bbox)[1], 'drawer box over the panel');
  assert(boxMax(boxes[4].bbox)[1] <= stretchers[1].bbox.min[1] - 5 + 1e-6, 'drawer box under the stretcher');
  // The door bay: a fixed shelf halfway between the panel and the stretcher, an adjustable shelf above and below it.
  const fixed = cab.parts.filter((p) => p.name === 'Fixed shelf');
  assertEq(fixed.length, 1);
  assertApprox(fixed[0].bbox.min[1] + t / 2, (panel.bbox.min[1] + boxMax(stretchers[1].bbox)[1]) / 2);
  const shelves = byTop('shelf');
  assertEq(shelves.length, 2);
  assert(shelves[0].bbox.min[1] > boxMax(fixed[0].bbox)[1] && boxMax(shelves[0].bbox)[1] < panel.bbox.min[1], 'shelf over the fixed one');
  assert(shelves[1].bbox.min[1] > boxMax(stretchers[1].bbox)[1] && boxMax(shelves[1].bbox)[1] < fixed[0].bbox.min[1], 'shelf under the fixed one');
  // No two case parts overlap.
  const caseParts = cab.parts.filter((p) => p.material === 'case' && !isPlinth(p.role));
  for (let i = 0; i < caseParts.length; i++) for (let j = i + 1; j < caseParts.length; j++) assert(!boxIntersection(caseParts[i].bbox, caseParts[j].bbox), `${caseParts[i].name} overlaps ${caseParts[j].name}`);
  // Too much: an error.
  spec.fronts.sections[2].height = 2000;
  let threw = '';
  try {
    buildCabinet(spec, c);
  } catch (e) {
    threw = e.message;
  }
  assert(/the fronts take/.test(threw), threw);
});

test('front stack: older front types read as stacks', () => {
  const spec = newCabinet('base', 1);
  spec.shelves = 2;
  spec.fronts = { type: 'drawerOverDoors', drawerHeight: 150, doorCount: 2 };
  assertEq(stackFronts(spec).sections.map((s) => [s.type, s.height ?? null, s.doors ?? null, s.shelves ?? null].join()), ['drawer,150,,', 'door,,2,2']);
  spec.fronts = { type: 'drawers', count: 2, units: [12, 12] };
  assertEq(stackFronts(spec).sections.map((s) => s.units), [12, 12]);
  spec.fronts = { type: 'open' };
  assertEq(stackFronts(spec).sections[0].type, 'open');
  // New drawers have a stretcher under them (none under the bottom one).
  const db = buildCabinet(drawerBase(3, 3), defaultConstruction());
  assertEq(db.parts.filter((p) => p.name === 'Stretcher').length, 2);
  assertEq(newSection('drawer').below, 'stretcher');
  assertEq(stackFronts({ fronts: { type: 'drawers', count: 2 } }).sections.map((s) => s.below), ['none', 'none']);
  // A new cabinet: one door section with the kind's shelves.
  assertEq(newCabinet('wall', 2).fronts.sections.map((s) => [s.type, s.shelves].join()), ['door,2']);
});

test('appliance sketches fit their spaces', () => {
  const c = defaultConstruction();
  const top = (b) => b.min[1] + b.size[1];
  const within = (sketch, spec) => sketch.every((b) => b.min[0] >= 0 && b.min[0] + b.size[0] <= spec.width + 1e-6 && b.min[1] >= 0 && b.min[2] >= 0);
  const dw = newSpace('dishwasher', 1, c);
  const dws = applianceSketch(dw, { ft: 19, top: 30 });
  assert(dws.length && within(dws, dw), 'dishwasher');
  assert(Math.max(...dws.map(top)) <= dw.height, 'dishwasher under the countertop');
  const rg = newSpace('range', 2, c);
  const rgs = applianceSketch(rg, { ft: 19, top: 30 });
  assert(within(rgs, rg), 'range');
  // The cooktop comes up to the countertop.
  assertApprox(top(rgs.find((b) => b.tone === 'black' && b.size[1] === 12)), rg.height + 30);
  const fr = newSpace('fridge', 3, c);
  const frs = applianceSketch(fr, { ft: 19 });
  assert(within(frs, fr), 'fridge');
  assertApprox(Math.max(...frs.map(top)), fr.height); // as tall as its space
  assertApprox(Math.max(...applianceSketch({ ...fr, height: 1700 }).map(top)), 1700);
  assertEq(applianceSketch(newSpace('space', 4, c)).length, 0);
});

test('undermount drawer box (818 EVOLUTION, 16 mm, 100 mm sides)', () => {
  const [spec, c] = base();
  c.library.find((m) => m.id === c.materials.drawerBox).thickness = 16;
  spec.fronts = { type: 'drawerOverDoors', drawerHeight: 150, doorCount: 0 };
  const cab = buildCabinet(spec, c);
  const side = part(cab, 'drawerSide');
  const subFront = part(cab, 'drawerSubFront');
  const back = part(cab, 'drawerBack');
  const bottom = part(cab, 'drawerBottom');
  // 550 slide -> 540 drawer length; 100 mm sides.
  assertApprox(side.length, 540);
  assertApprox(side.width, 100);
  // From the front: 12 raise, 16 bottom, 72 sub-front. Back is 88.
  assertApprox(bottom.bbox.min[1] - side.bbox.min[1], 12);
  assertApprox(bottom.thickness, 16);
  assertApprox(subFront.width, 72);
  assertApprox(subFront.bbox.min[1] - side.bbox.min[1], 28);
  assertApprox(back.width, 88);
  assertApprox(back.bbox.min[1] - side.bbox.min[1], 12);
  // Inside width = cabinet inside width - 42; box sits 21 from each case side.
  assertApprox(subFront.length, 600 - 32 - 42);
  assertApprox(side.bbox.min[0], 21);
  // Bottom runs from the front of the box to the back's front face.
  assertApprox(bottom.width, 540 - 16);
  assertApprox(boxMax(bottom.bbox)[2], spec.depth);
  assertApprox(bottom.bbox.min[2], boxMax(back.bbox)[2]);
  assert(cab.parts.filter((p) => isDrawerBox(p.role)).every((p) => p.ops.length === 0), 'no grooves');
});

test('818 EVOLUTION slide holes in both sides', () => {
  const c = defaultConstruction();
  const spec = drawerBase(1, 3);
  const cab = buildCabinet(spec, c);
  const t = caseT(c);
  for (const role of ['leftSide', 'rightSide']) {
    const holes = bores(part(cab, role)).filter((b) => b.purpose === 'slide');
    // 550 slide: 6 positions x 2 rows, for each of 3 drawers.
    assertEq(holes.length, 3 * 6 * 2, role);
    assertEq([...new Set(holes.map((b) => b.y))].sort((a, b) => a - b), [37, 69, 165, 261, 284, 339]);
    // Lowest drawer: slides stand on the cabinet bottom, screws 26 and 38 above it.
    const lowest = [...new Set(holes.map((b) => b.x))].sort((a, b) => a - b).slice(0, 2);
    assertEq(lowest, [t + 26, t + 38], role);
  }
  // Its drawer bottom rides on the runners, 28 above the cabinet bottom.
  const bottoms = cab.parts.filter((p) => p.role === 'drawerBottom').map((p) => p.bbox.min[1]);
  assertApprox(Math.min(...bottoms), c.toeKickHeight + t + 28);
});

test('shorter slides use their own hole pattern', () => {
  const spec = drawerBase(1, 2);
  spec.depth = 400; // 350 slide
  const cab = buildCabinet(spec, defaultConstruction());
  const ys = bores(part(cab, 'leftSide')).filter((b) => b.purpose === 'slide').map((b) => b.y);
  assertEq([...new Set(ys)].sort((a, b) => a - b), [37, 69, 165, 229]);
});

test('drawer over doors: no system holes in the drawer zone', () => {
  const [spec, c] = base();
  spec.fronts = { type: 'drawerOverDoors', drawerHeight: 150, doorCount: 0 };
  const cab = buildCabinet(spec, c);
  const side = part(cab, 'leftSide');
  const slideHoles = bores(side).filter((b) => b.purpose === 'slide');
  assert(slideHoles.length > 0);
  const lowestSlide = Math.min(...slideHoles.map((b) => b.x));
  assert(bores(side).filter((b) => b.purpose === 'system').every((b) => b.x < lowestSlide - 10));
  // No two holes overlap.
  const all = bores(side);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [a, b] = [all[i], all[j]];
      assert(Math.hypot(a.x - b.x, a.y - b.y) >= (a.diameter + b.diameter) / 2, `holes overlap at x=${a.x},${b.x} y=${a.y}`);
    }
  }
});

test('drawer base: 100 mm sides in the 5-unit top drawer, 200 below; equal fronts get 200', () => {
  const spec = drawerBase(1, 3);
  const sides = (cab) => cab.parts.filter((p) => p.role === 'drawerSide').map((p) => p.width).sort().join();
  assertEq(sides(buildCabinet(spec, defaultConstruction())), '100,100,200,200,200,200');
  spec.fronts = { type: 'drawers', count: 3 };
  assertEq(sides(buildCabinet(spec, defaultConstruction())), '200,200,200,200,200,200');
});

test('drawer fronts in 32 mm units: 5 / 9 / 10 = 157 / 285 / 317, boxes from their sizes', () => {
  const c = defaultConstruction();
  const spec = drawerBase(1, 3, c);
  assertEq(frontUnits(c, spec), 24); // 768 box less the 1.5 top reveal, plus one gap: 24 units
  spec.fronts = { type: 'drawers', count: 3, units: [5, 9, 10] };
  const cab = buildCabinet(spec, c);
  const fronts = cab.parts.filter((p) => p.role === 'drawerFront').sort((a, b) => boxMax(b.bbox)[1] - boxMax(a.bbox)[1]);
  assertEq(fronts.map((p) => Math.round(p.width)).join(), '157,285,317');
  const top = spec.height - c.reveals.top;
  assertApprox(boxMax(fronts[0].bbox)[1], top);
  for (let i = 1; i < 3; i++) assertApprox(boxMax(fronts[i].bbox)[1], fronts[i - 1].bbox.min[1] - c.reveals.gap);
  // Each drawer's box comes from its size: 5 units take 100 mm sides, 9 and 10 take 200.
  const sides = cab.parts.filter((p) => p.role === 'drawerSide').sort((a, b) => b.bbox.min[1] - a.bbox.min[1]);
  assertEq(sides.map((p) => p.width).join(), '100,100,200,200,200,200');
  // A size names its own box.
  c.drawerSizes.find((s) => s.units === 9).box = 150;
  const custom = buildCabinet(spec, c).parts.filter((p) => p.role === 'drawerSide').map((p) => p.width);
  assertEq(custom.filter((w) => w === 150).length, 2);
  // A box too tall for its front, or too many units, is an error.
  c.drawerSizes.find((s) => s.units === 5).box = 200;
  let threw = '';
  try {
    buildCabinet(spec, c);
  } catch (e) {
    threw = e.message;
  }
  assert(/drawer box/.test(threw), threw);
  spec.fronts.units = [5, 9, 11];
  try {
    buildCabinet(spec, defaultConstruction());
    threw = '';
  } catch (e) {
    threw = e.message;
  }
  assert(/25 units/.test(threw), threw);
  assertEq(splitUnits(24, 3).join(), '8,8,8');
  assertEq(splitUnits(24, 5).join(), '4,5,5,5,5');
  assertEq(splitUnits(24, 3, 5).join(), '5,9,10');
  assertEq(splitUnits(24, 4, 5).join(), '5,6,6,7');
  assertEq(splitUnits(24, 2, 5).join(), '12,12'); // two drawers stay even
  assertEq(splitUnits(10, 3, 5).join(), '3,3,4'); // no room for a 5-unit top
  // Drawer over doors: the drawer in units.
  const dod = { ...newCabinet('base', 2, c), fronts: { type: 'drawerOverDoors', drawerHeight: 150, doorCount: 0, units: 5 } };
  const df = buildCabinet(dod, defaultConstruction()).parts.find((p) => p.role === 'drawerFront');
  assertApprox(df.width, 157);
});

test('shallow cabinet falls back to a shorter slide', () => {
  const spec = drawerBase(1, 2);
  spec.depth = 400; // inside depth 384: 350 slide (needs 353) fits, 400 does not
  const cab = buildCabinet(spec, defaultConstruction());
  assertApprox(part(cab, 'drawerSide').length, 340);
});

test('drawer material thicker than the slide allows is an error', () => {
  const c = defaultConstruction();
  c.library.find((m) => m.id === c.materials.drawerBox).thickness = 18;
  let message = '';
  try {
    buildCabinet(drawerBase(1, 3), c);
  } catch (e) {
    message = e.message;
  }
  assert(message.includes('16 mm'), message);
});

test('cabinet overrides change only that cabinet', () => {
  const p = newProject();
  const c = p.construction;
  const black = nextMaterialId(c);
  c.library.push(newMaterial(black, 'Black melamine', 'Melamine', 19, '#222222'));
  p.cabinets[1].overrides = { materials: { case: black }, toeKickHeight: 100, back: { type: 'dado', depth: 6 } };
  const built = buildAll(p);
  const plain = built[0].cabinet;
  const custom = built[1].cabinet;
  assertApprox(part(plain, 'leftSide').thickness, 16);
  assertApprox(part(custom, 'leftSide').thickness, 19);
  assertApprox(part(custom, 'leftSide').length, 880 - 100);
  assertEq(part(custom, 'back').materialId, black);
  assertEq(pockets(part(custom, 'bottom')).length, 1);
  assertEq(pockets(part(plain, 'bottom')).length, 0);
  // Job construction itself is untouched, and the cut list uses each cabinet's material.
  assertApprox(c.toeKickHeight, 110);
  const list = projectCutList(p, built);
  assert(list.rows.some((r) => r.material === 'Black melamine' && r.cabinets.includes(p.cabinets[1].name)));
  assert(!list.rows.some((r) => r.material === 'Black melamine' && r.cabinets.includes(p.cabinets[0].name)));
});

const overlaps = (a, b) =>
  a.x < b.x + b.sizeX && b.x < a.x + a.sizeX && a.y < b.y + b.sizeY && b.y < a.y + a.sizeY;

test('nesting keeps parts on the sheet, apart by the kerf', () => {
  const opts = { sheetLength: 2440, sheetWidth: 1220, kerf: 4, trim: 10, grain: false };
  const items = Array.from({ length: 30 }, (_, i) => ({ length: 300 + (i % 7) * 70, width: 200 + (i % 5) * 60, n: i }));
  const { sheets, unplaced } = nestItems(items, opts);
  assertEq(unplaced.length, 0);
  assertEq(sheets.flatMap((s) => s.parts).length, items.length);
  for (const s of sheets) {
    for (const p of s.parts) {
      assert(p.x >= 10 && p.y >= 10, 'inside trim');
      assert(p.x + p.sizeX <= 2430 + 1e-9 && p.y + p.sizeY <= 1210 + 1e-9, 'inside trim');
      const grown = { ...p, sizeX: p.sizeX + 4, sizeY: p.sizeY + 4 };
      assert(s.parts.every((q) => q === p || !overlaps(grown, q)), 'kerf between parts');
    }
  }
});

test('nesting keeps grain along the sheet length', () => {
  // 1000 x 2000 only fits rotated; with grain it must be reported unplaced.
  const tall = [{ length: 1000, width: 1200 }, { length: 1100, width: 300 }];
  const free = nestItems(tall, { sheetLength: 2440, sheetWidth: 1220, grain: false });
  const grained = nestItems(tall, { sheetLength: 2440, sheetWidth: 1220, grain: true });
  assert(grained.sheets.flatMap((s) => s.parts).every((p) => !p.rotated));
  assertEq(free.unplaced.length, 0);
  assertEq(nestItems([{ length: 1000, width: 2000 }], { sheetLength: 2440, sheetWidth: 1220, grain: true }).unplaced.length, 1);
  assertEq(nestItems([{ length: 1000, width: 2000 }], { sheetLength: 2440, sheetWidth: 1220, grain: false }).unplaced.length, 0);
});

/** True when the rectangles can be separated by straight edge-to-edge cuts. */
function guillotine(rects) {
  if (rects.length <= 1) return true;
  for (const [pos, size] of [['x', 'sizeX'], ['y', 'sizeY']]) {
    for (const r of rects) {
      const cut = r[pos] + r[size];
      const before = rects.filter((q) => q[pos] + q[size] <= cut + 1e-6);
      const after = rects.filter((q) => q[pos] >= cut - 1e-6);
      if (before.length && after.length && before.length + after.length === rects.length) {
        return guillotine(before) && guillotine(after);
      }
    }
  }
  return false;
}

const mixedParts = () =>
  Array.from({ length: 40 }, (_, i) => ({ length: 250 + ((i * 137) % 900), width: 120 + ((i * 89) % 480), n: i }));

test('panel-saw nesting is cuttable with straight through-cuts', () => {
  const opts = { sheetLength: 2440, sheetWidth: 1220, kerf: 4, trim: 10, mode: 'saw', effort: 'quick' };
  const { sheets, unplaced } = nestItems(mixedParts(), opts);
  assertEq(unplaced.length, 0);
  for (const s of sheets) assert(guillotine(s.parts), 'sheet is guillotine-cuttable');
});

test('optimizer is repeatable and never worse than a single pass', () => {
  const opts = { sheetLength: 2440, sheetWidth: 1220, kerf: 4, trim: 10 };
  const quick = nestItems(mixedParts(), { ...opts, effort: 'quick' });
  const a = nestItems(mixedParts(), { ...opts, effort: 'normal' });
  const b = nestItems(mixedParts(), { ...opts, effort: 'normal' });
  assertEq(a, b, 'same input gives the same plan');
  assert(a.sheets.length <= quick.sheets.length);
  // Parts are numbered once each, and every sheet reports use and offcut.
  const numbers = a.sheets.flatMap((s) => s.parts.map((p) => p.number));
  assertEq(numbers, numbers.map((_, i) => i + 1));
  assert(a.sheets.every((s) => s.used > 0 && s.used <= 1 && s.offcut.length >= 0));
  // Total sheet count can't beat the area bound.
  const area = mixedParts().reduce((t, p) => t + p.length * p.width, 0);
  assert(a.sheets.length >= Math.ceil(area / (2440 * 1220)));
});

test('grouping lays same-size parts side by side, at no extra sheet', () => {
  const drawerParts = [
    ...Array(3).fill({ length: 526, width: 528, name: 'Drawer bottom' }),
    ...Array(6).fill({ length: 540, width: 200, name: 'Drawer side' }),
    ...Array(3).fill({ length: 526, width: 188, name: 'Drawer back' }),
    ...Array(3).fill({ length: 526, width: 176, name: 'Drawer sub-front' }),
  ];
  for (const mode of ['cnc', 'saw']) {
    for (const grain of [false, true]) {
      const opts = { sheetLength: 2438.4, sheetWidth: 1219.2, kerf: 4, trim: 10, mode, grain, effort: 'quick' };
      const loose = nestItems(drawerParts, opts);
      const grouped = nestItems(drawerParts, { ...opts, group: true });
      const tag = `${mode} grain=${grain}`;
      assert(grouped.sheets.length <= loose.sheets.length, tag);
      assertEq(grouped.unplaced, []);
      const parts = grouped.sheets.flatMap((s) => s.parts);
      assertEq(parts.length, drawerParts.length, tag);
      if (grain) assert(parts.every((p) => !p.rotated), `${tag}: grain`);
      for (const s of grouped.sheets) {
        if (mode === 'saw') assert(guillotine(s.parts), `${tag}: guillotine`);
        for (const p of s.parts) {
          const grown = { ...p, sizeX: p.sizeX + 4, sizeY: p.sizeY + 4 };
          assert(s.parts.every((q) => q === p || !overlaps(grown, q)), `${tag}: kerf between parts`);
        }
      }
      // Identical parts are numbered together: each size forms few runs.
      const runs = parts.filter((p, i) => i === 0 || parts[i - 1].name !== p.name).length;
      assert(runs <= 6, `${tag}: ${runs} runs of same-size parts`);
      // ...and sit next to each other: every side touches another side, a kerf apart.
      const sides = parts.filter((p) => p.name === 'Drawer side');
      const touch = (a, b) =>
        (Math.abs(a.x + a.sizeX + 4 - b.x) < 1e-6 && a.y === b.y) || (Math.abs(a.y + a.sizeY + 4 - b.y) < 1e-6 && a.x === b.x);
      assert(sides.every((a) => sides.some((b) => a !== b && (touch(a, b) || touch(b, a)))), `${tag}: sides together`);
    }
  }
});

test('nesting the default job groups by material', () => {
  const p = newProject();
  const built = buildAll(p).map((b) => b.cabinet);
  const groups = nestJob(built, p.construction);
  assertEq(groups.map((g) => g.material.name), ['White melamine', 'Painted MDF', 'Baltic birch']);
  const total = groups.reduce((s, g) => s + g.sheets.flatMap((x) => x.parts).length, 0);
  assertEq(total, built.reduce((s, cab) => s + cab.parts.length, 0));
  assert(groups.every((g) => g.yield > 0 && g.yield <= 1 && g.unplaced.length === 0));
});

test('reordering cabinets re-lays each run in list order', () => {
  const p = newProject(); // drawer base, base, wall, wall, tall
  const names = () => p.cabinets.map((c) => c.name);
  moveCabinet(p, 1, 0); // base before the drawer base
  assertEq(names().slice(0, 2), ['Base 2', 'Drawer base 1']);
  assertEq(
    p.cabinets.map((c) => c.x),
    [0, 600, 0, 600, 1200],
  );
  // Tall to the front: it now starts both runs, everything else moves along.
  moveCabinet(p, 4, 0);
  assertEq(
    p.cabinets.map((c) => [c.name, c.x]),
    [
      ['Tall 5', 0],
      ['Base 2', 600],
      ['Drawer base 1', 1200],
      ['Wall 3', 600],
      ['Wall 4', 1200],
    ],
  );
});

test('a filler between base cabinets pushes the run along', () => {
  const p = newProject();
  insertCabinet(p, newFiller('base'), 1); // between drawer base and base
  const filler = p.cabinets[1];
  assertEq(filler.name, 'Filler 6');
  assertEq(
    p.cabinets.map((c) => c.x),
    [0, 600, 650, 0, 600, 1250],
  );
  // Walls stay where they were; the tall closes both runs after the base.
  const cab = buildAll(p)[1].cabinet;
  const strip = part(cab, 'filler');
  const c = p.construction;
  assertEq(strip.material, 'front');
  assertApprox(strip.thickness, 19);
  assertApprox(strip.width, 50);
  assertApprox(strip.length, 880 - c.toeKickHeight);
  assertApprox(strip.bbox.min[2], filler.depth); // flush with the doors
  // Its own plinth front, before joinPlinths runs it into its neighbours'.
  const toe = part(buildCabinet(filler, c), 'toeKick');
  assertApprox(toe.length, 50);
  assertApprox(toe.width, c.toeKickHeight);
});

test('a filler can be placed after any cabinet in its run', () => {
  // Default job: drawer base, base, wall, wall, tall.
  const p = newProject();
  const [, , w1, w2] = p.cabinets;
  const filler = newFiller('wall');
  const at = insertCabinet(p, filler, 1); // between the two base cabinets in the list
  // Its run: the wall cabinets and the tall one.
  assertEq(runNeighbours(p, at).map((n) => n.spec.kind), ['wall', 'wall', 'tall']);
  // Listed before every wall cabinet: start of the wall run.
  assertEq(placedAfter(p, at), null);
  assertApprox(filler.x, 0);
  let i = placeAfter(p, at, w1.id);
  assertEq(p.cabinets[i], filler);
  assertEq(placedAfter(p, i), w1.id);
  assertApprox(filler.x, w1.x + w1.width);
  assertApprox(w2.x, filler.x + filler.width);
  i = placeAfter(p, i, w2.id);
  assertApprox(filler.x, w2.x + w2.width);
  i = placeAfter(p, i, null);
  assertApprox(filler.x, 0);
  assertApprox(w1.x, filler.width);
});

test('a base filler follows its cabinet: no toe kick beside one without', () => {
  const p = newProject();
  const [db, b] = p.cabinets;
  const filler = newFiller('base');
  const at = insertCabinet(p, filler, 1); // after the drawer base
  // Its own parts, before its plinth rails are joined to its neighbours'.
  const roles = (i = at) => buildCabinet(p.cabinets[i], jobFor(p, i)).parts.map((x) => x.role);
  assertEq(roles(), ['filler', 'toeKick', 'plinthRear']);
  db.overrides = { plinth: 'none' };
  assertEq(roles(), ['filler']);
  // Toe kick height 0 on the cabinet: the filler runs to the floor too.
  db.overrides = { toeKickHeight: 0 };
  assertEq(roles(), ['filler']);
  assertApprox(buildCabinet(filler, jobFor(p, at)).parts[0].length, filler.height);
  // At the start of the run it follows the next cabinet.
  db.overrides = { plinth: 'none' };
  b.overrides = {};
  const first = placeAfter(p, at, null);
  assertEq(baseSource(p, first), db);
  assertEq(roles(first), ['filler']);
  // The filler's own setting still wins.
  filler.overrides = { plinth: 'board' };
  assertEq(roles(first), ['filler', 'toeKick']);
});

const allParts = (built) => built.flatMap((b) => b.cabinet?.parts ?? []);

test('side-by-side cabinets and fillers share one plinth front and rear', () => {
  // Default job: drawer base, base, tall in a row along the floor; a filler between the bases.
  const p = newProject();
  insertCabinet(p, newFiller('base'), 1);
  const built = buildAll(p);
  const parts = allParts(built);
  for (const role of ['toeKick', 'plinthRear']) {
    const rails = parts.filter((x) => x.role === role);
    assertEq(rails.length, 1, role);
    assertApprox(rails[0].length, 600 + 50 + 600 + 600, role);
  }
  // Boards belong to the first cabinet of the run.
  assertEq(built[0].cabinet.parts.filter((x) => x.role === 'toeKick').length, 1);
  // Cross members at every cabinet edge, one shared where base meets tall,
  // none for the filler (the cabinets either side carry it).
  assertEq(parts.filter((x) => x.role === 'plinthEnd').length, 5);
  assertEq(built[1].cabinet.parts.map((x) => x.role), ['filler']);
});

test('joined plinth boards respect the sheet length, breaking at cabinet edges', () => {
  const p = newProject();
  p.cabinets = [];
  for (let i = 0; i < 5; i++) addCabinet(p, newCabinet('base'));
  const max = maxBoardLength(p.construction, p.construction.materials.case);
  assertApprox(max, 97 * 25.4 - 20); // 49x97 melamine less 10 trim each end
  const fronts = allParts(buildAll(p)).filter((x) => x.role === 'toeKick').map((x) => x.length);
  assertEq(fronts, [2400, 600]);
  assertEq(splitBoards([[0, 5000]], 2000), [[0, 5000 / 3], [5000 / 3, 10000 / 3], [10000 / 3, 5000]]);
});

test('cabinets side by side share one cross member, centred on the joint', () => {
  const p = newProject();
  p.cabinets = [];
  for (let i = 0; i < 3; i++) addCabinet(p, newCabinet('base'));
  const built = buildAll(p);
  const t = caseT(p.construction);
  const xs = placedParts(p, built)
    .filter((pp) => pp.part.role === 'plinthEnd')
    .map((pp) => pp.min[0])
    .sort((a, b) => a - b);
  assertEq(xs, [0, 600 - t / 2, 1200 - t / 2, 1800 - t]);
  assertEq(overlaps3d(wholeRun(p, built)), []);
});

test('a frame ending at a filler gets a cross member there', () => {
  const p = newProject();
  p.cabinets = [];
  addCabinet(p, newCabinet('base'));
  addCabinet(p, newFiller('base'));
  const built = buildAll(p);
  const end = part(built[1].cabinet, 'plinthEnd');
  assertApprox(end.bbox.min[0], 50 - caseT(p.construction));
  assertEq(overlaps3d(wholeRun(p, built)), []);
});

/** Every part of the job in world space, as one cabinet for overlaps3d. */
const wholeRun = (p, built) => ({
  parts: placedParts(p, built).map((pp) => ({ ...pp.part, bbox: { min: pp.min, size: pp.size }, cuts: pp.cuts })),
});

test('joined plinths overlap nothing across the run', () => {
  const p = newProject();
  insertCabinet(p, newFiller('base'), 1);
  p.cabinets[0].endPanels = { left: true, right: false };
  relayout(p);
  assertEq(overlaps3d(wholeRun(p, buildAll(p))), []);
});

test('wall filler has no plinth', () => {
  const cab = buildCabinet(newFiller('wall', 1), defaultConstruction());
  assertEq(cab.parts.length, 1);
  assertApprox(part(cab, 'filler').length, 720);
});

test('base "none": no toe kick, the case takes the full cabinet height', () => {
  const [spec, c] = base();
  c.plinth = 'none';
  const cab = buildCabinet(spec, c);
  assert(cab.parts.every((p) => !isPlinth(p.role)));
  const side = part(cab, 'leftSide');
  assertApprox(side.bbox.min[1], 0);
  assertApprox(side.length, spec.height);
  // Fronts cover the full height less the top reveal.
  assertApprox(part(cab, 'door').length, spec.height - c.reveals.top - c.reveals.bottom);
  const filler = buildCabinet(newFiller('base', 2), c);
  assertEq(filler.parts.map((p) => p.role), ['filler']);
  assertApprox(filler.parts[0].length, 880);
  // End panels keep the floor scribe but lose the notch.
  spec.endPanels = { left: true, right: false };
  const ep = part(buildCabinet(spec, c), 'endPanel');
  assertApprox(ep.length, 890);
  assertEq(pockets(ep), []);
});

test('end panels: 645 x 890 with a 55 x 120 toe-kick notch on a base', () => {
  const [spec, c] = base();
  spec.endPanels = { left: true, right: true };
  const cab = buildCabinet(spec, c);
  const panels = cab.parts.filter((p) => p.role === 'endPanel');
  assertEq(panels.length, 2);
  const ft = thickness(c, 'front');
  for (const p of panels) {
    assertApprox(p.length, 890);
    assertApprox(p.width, 645);
    assertApprox(p.thickness, ft);
    // 22 proud of the case front, 10 below the floor and 13 behind the case for scribing.
    assertApprox(boxMax(p.bbox)[2], spec.depth + 22);
    assertApprox(p.bbox.min[2], -13);
    assertApprox(p.bbox.min[1], -10);
    assertEq(pockets(p).map((o) => [o.x, o.y, o.length, o.width]), [[0, 0, 120, 55]]);
  }
  assertApprox(panels[0].bbox.min[0], -ft);
  assertApprox(panels[1].bbox.min[0], spec.width);
  assertEq(overlaps3d(cab), []);
});

test('end panel without toe kick keeps the scribe allowance', () => {
  const [spec, c] = base();
  spec.endPanels = { left: true, right: false };
  spec.overrides = { endPanel: { toeKick: false } };
  const p = part(buildCabinet(spec, c), 'endPanel');
  assertApprox(p.length, 890);
  assertApprox(p.width, 645);
  assertEq(pockets(p), []);
  // Wall panels: rear scribe, no floor scribe or notch.
  const wall = newCabinet('wall', 2);
  wall.endPanels = { left: true, right: false };
  const wp = part(buildCabinet(wall, c), 'endPanel');
  assertApprox(wp.length, wall.height);
  assertApprox(wp.width, wall.depth + 22 + 13);
  assertEq(pockets(wp), []);
});

test('end panels make room in the run', () => {
  const p = newProject();
  const ft = thickness(p.construction, 'front');
  p.cabinets[0].endPanels = { left: true, right: true };
  relayout(p);
  assertApprox(p.cabinets[0].x, ft);
  assertApprox(p.cabinets[1].x, ft + p.cabinets[0].width + ft);
});

test('default sheet sizes: 49x97 melamine, 48x96 otherwise', () => {
  const c = defaultConstruction();
  const sizes = Object.fromEntries(c.library.map((m) => [m.kind, [m.sheetLength, m.sheetWidth]]));
  assertEq(sizes.Melamine.map((v) => +v.toFixed(1)), [2463.8, 1244.6]);
  assertEq(sizes.MDF.map((v) => +v.toFixed(1)), [2438.4, 1219.2]);
  assertEq(sizes.Plywood.map((v) => +v.toFixed(1)), [2438.4, 1219.2]);
  assertEq(defaultSheetSize('Particleboard').map((v) => +v.toFixed(1)), [2438.4, 1219.2]);
});

const volume = (b) => b.size[0] * b.size[1] * b.size[2];

/** Total overlapping volume between any two parts' solids. */
function overlaps3d(cab) {
  const solids = cab.parts.map((p) => partSolids(p));
  const found = [];
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      let v = 0;
      for (const a of solids[i]) for (const b of solids[j]) v += volume(boxIntersection(a, b) ?? { size: [0, 0, 0] });
      if (v > 1e-3) found.push(`${cab.parts[i].name} / ${cab.parts[j].name}: ${v.toFixed(1)} mm³`);
    }
  }
  return found;
}

test('no two parts overlap, with butt or dado backs', () => {
  for (const back of [{ type: 'butt' }, { type: 'dado', depth: 6 }]) {
    const c = defaultConstruction();
    c.back = back;
    const specs = [newCabinet('base', 1), newCabinet('wall', 2), newCabinet('tall', 3), drawerBase(4, 3), newFiller('base', 5)];
    specs[0].fronts = { type: 'drawerOverDoors', drawerHeight: 150, doorCount: 0 };
    for (const s of specs.slice(0, 4)) s.endPanels = { left: true, right: true };
    for (const spec of specs) {
      const found = overlaps3d(buildCabinet(spec, c));
      assert(found.length === 0, `${back.type} ${spec.name}: ${found.join('; ')}`);
    }
  }
});

test('dado is cut out of the bottom and top solids', () => {
  const c = defaultConstruction();
  c.back = { type: 'dado', depth: 6 };
  const cab = buildCabinet(newCabinet('wall', 1), c);
  const t = caseT(c);
  for (const role of ['bottom', 'top']) {
    const p = part(cab, role);
    const removed = volume(p.bbox) - partSolids(p).reduce((v, b) => v + volume(b), 0);
    assertApprox(removed, p.length * t * 6, `${role} dado volume`);
    // The back fills exactly that space.
    const inBack = partSolids(p).every((b) => !boxIntersection(b, part(cab, 'back').bbox));
    assert(inBack, `${role} does not overlap the back`);
  }
});

// ---- shaker fronts -------------------------------------------------------------

const shaker = (c) => Object.assign(c, { frontStyle: 'shaker' });
const op = (p, type) => p.ops.find((o) => o.type === type);

test('a shaker door is a frame with a rabbet and a center panel flush at the back', () => {
  const [spec, c] = base();
  const cab = buildCabinet(spec, shaker(c));
  const door = part(cab, 'door');
  const panel = part(cab, 'frontPanel');
  const sh = c.shaker;
  const pt = thickness(c, 'panel');
  assertApprox(pt, 6.35, 'panel material');
  assertEq(panel.materialId, c.materials.panel);
  const opening = op(door, 'opening');
  assertApprox(opening.x, sh.frame);
  assertApprox(opening.y, sh.frame);
  assertApprox(opening.length, door.length - 2 * sh.frame);
  assertApprox(opening.width, door.width - 2 * sh.frame);
  const rb = op(door, 'rabbet');
  assertApprox(rb.depth, pt, 'rabbet as deep as the panel');
  assertApprox(rb.lip, sh.rabbet);
  assertApprox(rb.x, sh.frame - sh.rabbet);
  assertApprox(rb.length, opening.length + 2 * sh.rabbet);
  assertEq(door.edges, { l1: false, l2: false, w1: false, w2: false }, 'frame not banded');
  // The panel: the opening plus the rabbet less the clearance on each side.
  assertApprox(panel.length, opening.length + 2 * (sh.rabbet - sh.clearance));
  assertApprox(panel.width, opening.width + 2 * (sh.rabbet - sh.clearance));
  assertApprox(panel.bbox.min[2], door.bbox.min[2], 'back flush');
  assert(partSolids(door).every((b) => !boxIntersection(b, panel.bbox)), 'panel clear of the frame');
  // Removed: the opening through, and the ring of the rabbet behind the frame.
  const volume = (b) => b.size[0] * b.size[1] * b.size[2];
  const removed = volume(door.bbox) - partSolids(door).reduce((v, b) => v + volume(b), 0);
  const ring = (rb.length * rb.width - opening.length * opening.width) * pt;
  assertApprox(removed, opening.length * opening.width * door.thickness + ring, 'removed volume');
  assertApprox(panel.cornerRadius, c.cnc.toolDiameter / 2);
  assert(panel.outline.every(([x, y]) => x >= -1e-9 && x <= panel.length + 1e-9 && y >= -1e-9 && y <= panel.width + 1e-9), 'rounded outline in the panel');
  // The hinge cups stay on the frame.
  assert(bores(door).some((b) => b.purpose === 'hingeCup'), 'cups');
});

test('slab stays the default; short drawer fronts stay slab under shaker', () => {
  const c = defaultConstruction();
  assertEq(c.frontStyle, 'slab');
  assertEq(count(buildCabinet(newCabinet('base', 1), c), 'frontPanel'), 0);
  shaker(c);
  const cab = buildCabinet(drawerBase(1, 3, c), c);
  const fronts = cab.parts.filter((p) => p.role === 'drawerFront').sort((a, b) => b.bbox.min[1] - a.bbox.min[1]);
  assert(!fronts[0].shaker && fronts[0].edges.l1, 'the 5-unit top drawer is a banded slab');
  assert(fronts.slice(1).every((p) => p.shaker), 'the others are shaker');
  assertEq(count(cab, 'frontPanel'), 2);
  // A drawer front's length runs across: the opening still leaves the frame width all round.
  const f = fronts[1];
  const panel = cab.parts.find((p) => p.role === 'frontPanel' && p.name === `${f.name} panel`);
  assertApprox(panel.bbox.min[0] - f.bbox.min[0], c.shaker.frame - c.shaker.rabbet + c.shaker.clearance);
  assertApprox(panel.bbox.min[1] - f.bbox.min[1], c.shaker.frame - c.shaker.rabbet + c.shaker.clearance);
});

test('shaker hinge cups must clear the rabbet', () => {
  const [spec, c] = base();
  shaker(c).shaker.frame = 40;
  let error = null;
  try {
    buildCabinet(spec, c);
  } catch (e) {
    error = e;
  }
  assert(error && /rabbet/.test(error.message), 'cups into the rabbet are an error');
});

test('CNC cuts a shaker frame: rabbet, then the opening from inside, then the outline', () => {
  const p = newProject();
  shaker(p.construction);
  p.cabinets = [{ ...newCabinet('base', 1, p.construction), x: 0 }];
  const built = buildAll(p);
  const cab = built[0].cabinet;
  const key = (role) => `${p.cabinets[0].id}:${cab.parts.findIndex((q) => q.role === role)}`;
  const groups = cncGroups(p, built, new Set([key('door'), key('frontPanel')]));
  assertEq(groups.length, 2, 'frame and panel on their own materials');
  const cfg = p.construction.cnc;
  const R = cfg.toolDiameter / 2;
  const g = groups.find((g) => g.material.id === p.construction.materials.front);
  const sheet = nestGroup(g, { ...cncNesting(cfg), effort: 'quick' }).sheets[0];
  const T = g.material.thickness;
  const prog = sheetProgram(sheet, cfg, T);
  const at = (prefix) => prog.moves.findIndex((m) => m.comment?.startsWith(prefix));
  const [ri, oi, ci] = [at('Rabbet'), at('Opening'), at('Cut out')];
  assert(ri >= 0 && ri < oi && oi < ci, 'rabbet, opening, outline');
  const q = sheet.parts[0];
  const o = stockRect(q, q.openings[0]);
  const rb = stockRect(q, q.rabbets[0]);
  const inside = (m, r, k) => m.x >= r.x0 + k - 1e-6 && m.x <= r.x1 - k + 1e-6 && m.y >= r.y0 + k - 1e-6 && m.y <= r.y1 - k + 1e-6;
  const cutting = (from, to) => prog.moves.slice(from, to).filter((m) => m.g >= 1 && m.z < 0);
  const rabbetMoves = cutting(ri, oi);
  assertApprox(Math.min(...rabbetMoves.map((m) => m.z)), -thickness(p.construction, 'panel'), 'rabbet depth');
  assert(rabbetMoves.every((m) => inside(m, rb, R)), 'rabbet inside its outer edge');
  // The lap reaches the rabbet's edge, so the tool covers it out to the lip.
  assert(rabbetMoves.some((m) => approx(m.x, rb.x0 + R)), 'lap on the rabbet edge');
  assert(2 * R >= q.rabbets[0].lip, 'one lap covers the lip');
  const openMoves = cutting(oi, ci);
  assertApprox(Math.min(...openMoves.map((m) => m.z)), -(T + cfg.cutThrough), 'opening cut through');
  assert(openMoves.every((m) => inside(m, o, R)), 'tool stays in the opening');
  // Climb inside the opening runs clockwise.
  const lap = openMoves.filter((m) => m.g === 1);
  const area = lap.reduce((a, m, i) => a + m.x * lap[(i + 1) % lap.length].y - lap[(i + 1) % lap.length].x * m.y, 0);
  assert(area < 0, 'clockwise');
  assert(openMoves.some((m) => approx(m.z, -(T - cfg.tabHeight))), 'tabs hold the slug');
  // The panel: cut on its rounded outline, through the panel material.
  const pg = groups.find((g) => g.material.id === p.construction.materials.panel);
  const ps = nestGroup(pg, { ...cncNesting(cfg), effort: 'quick' }).sheets[0];
  assert(ps.parts[0].outline.length > 4, 'rounded corners');
  const pt = pg.material.thickness;
  const pp = sheetProgram(ps, cfg, pt).moves.filter((m) => m.g >= 1);
  assertApprox(Math.min(...pp.map((m) => m.z)), -(pt + cfg.cutThrough), 'panel cut through');
});

test('shaker paint: the frame loses its opening and gains its inside edges', () => {
  const [spec, c] = base();
  const cab = buildCabinet(spec, shaker(c));
  const door = part(cab, 'door');
  const { length: ol, width: ow } = op(door, 'opening');
  const [L, W, T] = [door.length, door.width, door.thickness];
  const g = c.paint.parts.fronts;
  const want = (L * W - ol * ow) * g.faces + (g.edges ? (2 * (L + W) + 2 * (ol + ow)) * T : 0);
  assertApprox(paintNeeded([{ parts: [door] }], c).groups[0].areaM2 * 1e6, want);
  assertEq(paintNeeded([{ parts: [part(cab, 'frontPanel')] }], c).groups[0].id, 'fronts', 'panels painted as fronts');
});

test('older saves get a door panel material', () => {
  const c = defaultConstruction();
  c.library = c.library.filter((m) => m.id !== 5);
  delete c.materials.panel;
  ensurePanelMaterial(c);
  const m = c.library.find((m) => m.id === c.materials.panel);
  assert(m && m.kind === 'MDF' && approx(m.thickness, 6.35), 'a 1/4" MDF added');
  const before = JSON.stringify(c);
  ensurePanelMaterial(c);
  assertEq(JSON.stringify(c), before, 'idempotent');
  // A slot pointing at an edge band is repaired with the existing 1/4" MDF.
  c.materials.panel = 4;
  ensurePanelMaterial(c);
  assertEq(c.materials.panel, m.id);
  assertEq(c.library.length, JSON.parse(before).library.length, 'nothing more added');
});

// ---- units -----------------------------------------------------------------

/** Runs fn with the given display units, then goes back to mm. */
function withUnits(u, fn) {
  setUnits(u);
  try {
    fn();
  } finally {
    setUnits({ system: 'mm' });
  }
}

test('units: mm display is unchanged', () => {
  assertEq(fmtLen(600), '600');
  assertEq(fmtLen(1.5), '1.5');
  assertEq(fmtLenU(19), '19 mm');
});

test('units: inch fractions at each precision', () => {
  assertEq(formatInches(23.625, 32), '23 5/8"');
  assertEq(formatInches(23.6, 8), '23 5/8"');
  assertEq(formatInches(0.75, 16), '3/4"');
  assertEq(formatInches(24, 16), '24"');
  assertEq(formatInches(23.622, 32), '23 5/8"');
  assertEq(formatInches(23.6875, 16), '23 11/16"');
  assertEq(formatInches(23.6875, 8), '23 3/4"');
  assertEq(formatInches(23.625, 0), '23.625"');
  assertEq(formatInches(-1.5, 16), '-1 1/2"');
});

test('units: feet and inches above 36"', () => {
  assertEq(formatInches(36, 16), '36"');
  assertEq(formatInches(48, 16), `4' 0"`);
  assertEq(formatInches(48.5, 16), `4' 1/2"`);
  assertEq(formatInches(54.25, 16), `4' 6 1/4"`);
  // Rounding up to the next foot carries over.
  assertEq(formatInches(47.999, 16), `4' 0"`);
  assertEq(formatInches(48, 16, { feet: false }), '48"');
});

test('units: a tiny length never shows as 0"', () => {
  assertEq(formatInches(0.3 / MM_PER_IN, 32), '0.0118"');
  assertEq(formatInches(0, 32), '0"');
});

test('units: fmtLen and fmtSize follow the setting', () => {
  withUnits({ system: 'in', precision: 16 }, () => {
    assertEq(fmtLen(600), '23 5/8"');
    assertEq(fmtLenU(600), '23 5/8"');
    assertEq(fmtLen(3657.6), `12' 0"`);
    assertEq(fmtSize(2438.4, 609.6), `8' 0" × 24"`);
  });
});

test('units: parseLen reads inches, fractions, feet and metric', () => {
  const inch = (s) => parseLen(s, 'in') / MM_PER_IN;
  assertApprox(inch('23.5'), 23.5);
  assertApprox(inch('23 1/2'), 23.5);
  assertApprox(inch('23-1/2"'), 23.5);
  assertApprox(inch('3/4'), 0.75);
  assertApprox(inch('.5'), 0.5);
  assertApprox(inch('23 1/2 in'), 23.5);
  assertApprox(inch('23″'), 23);
  assertApprox(inch("4'"), 48);
  assertApprox(inch(`4' 6"`), 54);
  assertApprox(inch(`4'-6 1/2"`), 54.5);
  assertApprox(inch("4'6"), 54);
  assertApprox(inch('4ft 6in'), 54);
  assertApprox(inch('1,200mm'), 1200 / MM_PER_IN);
  assertApprox(inch('-1/2'), -0.5);
  assertApprox(parseLen('600mm', 'in'), 600);
  assertApprox(parseLen('60 cm', 'in'), 600);
  assertApprox(parseLen('1.2m', 'in'), 1200);
  assertApprox(parseLen('600', 'mm'), 600);
  assertApprox(parseLen('24"', 'mm'), 609.6);
  for (const bad of ['', 'abc', '1/0', '23 1/', '4\' x', '--1']) assert(Number.isNaN(parseLen(bad, 'in')), `"${bad}" is not a length`);
});

test('units: what is shown reads back as the same value', () => {
  withUnits({ system: 'in', precision: 32 }, () => {
    for (const inches of [0.75, 23.625, 34.5, 48, 96.03125, 144]) {
      assertApprox(parseLen(fmtLen(inches * MM_PER_IN)), inches * MM_PER_IN);
    }
  });
});

test('units: US standard sizes build a 24" base cabinet with one door', () => {
  const c = usStandardSizes(defaultConstruction());
  const spec = newCabinet('base', 1, c);
  assertApprox(spec.width, 609.6);
  assertApprox(spec.height, 34.5 * MM_PER_IN);
  const cab = buildCabinet(spec, c);
  assertEq(cab.parts.filter((p) => p.role === 'door').length, 1, 'single door');
  const lib = JSON.stringify(defaultConstruction().library);
  assertEq(JSON.stringify(c.library), lib, 'materials untouched');
});

test('units: G-code in inches writes G20, inch coordinates and in/min feeds', () => {
  const cfg = defaultConstruction().cnc;
  const program = { minutes: 1, moves: [{ g: 1, x: 25.4, y: 50.8, z: -3.175, f: 2540 }, { g: 2, x: 0, y: 0, z: -3.175, i: 12.7, j: 0, f: 2540 }] };
  const mm = gcode(program, cfg, [], { units: 'mm' });
  assert(mm.includes('G21 G90'), 'mm program is G21');
  assert(mm.includes('X25.4 Y50.8 Z-3.175 F2540'), mm);
  const inch = gcode(program, cfg, [], { units: 'in' });
  assert(inch.includes('G20 G90') && !inch.includes('G21'), 'inch program is G20');
  assert(inch.includes('G1 X1 Y2 Z-0.125 F100'), inch);
  assert(inch.includes('I0.5 J0'), inch);
  assert(inch.includes('(Stock 49 x 49 in'), inch);
});

test('units: cut list CSV in inches has decimal inches and unit headers', () => {
  const p = newProject();
  const list = projectCutList(p);
  const [head, row] = cutListCsv(list, { units: 'in' }).split('\n');
  assert(head.includes('Thickness (mm),Length (in),Width (in)'), head);
  const r = list.rows[0];
  const cols = row.split(',');
  assertApprox(Number(cols[4]), Math.round((r.length / MM_PER_IN) * 1000) / 1000);
  assert(cutListCsv(list).startsWith('Qty,Part,Material,Thickness,Length,'), 'mm CSV unchanged');
});

// ---- AI tools --------------------------------------------------------------

/** Runs a tool and expects it to fail with a message matching re. */
function toolFails(p, name, input, re) {
  try {
    runTool(p, buildAll(p), name, input);
  } catch (e) {
    assert(e instanceof ToolError, `${name} threw ${e}`);
    assert(re.test(e.message), `${name}: ${e.message}`);
    return;
  }
  assert(false, `${name} should have failed`);
}

test('ai tools: schemas are well formed and names unique', () => {
  const names = AI_TOOLS.map((t) => t.name);
  assertEq(new Set(names).size, names.length);
  for (const t of AI_TOOLS) assert(t.schema.type === 'object' && typeof t.description === 'string', t.name);
  assert(systemPrompt().includes('millimetres'));
});

test('ai tools: lay out a wall with a sink base, drawer bank and dishwasher', () => {
  const p = emptyProject(defaultConstruction());
  const run = (name, input) => runTool(p, buildAll(p), name, input);
  run('update_room', { action: 'update_wall', id: 'w1', length: '3000mm' });
  const a = run('add_cabinet', { kind: 'base', width: '900mm', name: 'Sink base', fronts: [{ type: 'door', doors: 2, shelves: 0 }] });
  assert(a.change.includes('Sink base'));
  const sink = p.cabinets[0];
  run('add_cabinet', { kind: 'base', width: 600, fronts: [{ type: 'drawer' }, { type: 'drawer' }, { type: 'drawer' }] });
  run('add_item', { type: 'dishwasher', after_id: sink.id });
  assertEq(p.cabinets.map((c) => c.kind), ['base', 'space', 'base'], 'dishwasher right after the sink');
  const xs = p.cabinets.map((c) => c.x);
  assertApprox(xs[1], 900);
  assertApprox(xs[2], 900 + p.cabinets[1].width);
  assert(buildAll(p).every((b) => b.cabinet), 'everything builds');
  const text = layoutSummary(p, buildAll(p));
  assert(text.includes('"Sink base"') && text.includes('dishwasher space'), text);
});

test('ai tools: inch lengths, resize, move and remove', () => {
  withUnits({ system: 'in', precision: 16 }, () => {
    const p = emptyProject(defaultConstruction());
    const run = (name, input) => runTool(p, buildAll(p), name, input);
    run('add_cabinet', { kind: 'base', width: '24"' });
    run('add_cabinet', { kind: 'base', width: 18 });
    const [a, b] = p.cabinets;
    assertApprox(a.width, 609.6);
    assertApprox(b.width, 18 * MM_PER_IN, 'bare number is inches');
    run('update_cabinet', { id: a.id, width: '30 in', height: `2' 10 1/2"` });
    assertApprox(a.width, 762);
    assertApprox(a.height, 876.3);
    assertApprox(b.x, 762, 'the next one moved along');
    run('move_cabinet', { id: b.id, after_id: 0 });
    assertEq(p.cabinets[0].id, b.id, 'moved to the start');
    assertApprox(p.cabinets[1].x, 18 * MM_PER_IN);
    run('remove_cabinet', { id: b.id });
    assertEq(p.cabinets.length, 1);
    assertApprox(p.cabinets[0].x, 0, 'the run closed up');
  });
});

test('ai tools: islands, corner cabinets and settings', () => {
  const p = emptyProject(defaultConstruction());
  const run = (name, input) => runTool(p, buildAll(p), name, input);
  run('update_room', { action: 'add_wall', length: '2400mm', turn: 'inside' });
  const isl = run('update_room', { action: 'add_island', type: 'double', x: '1000mm', y: '2000mm' });
  const islandId = isl.result.match(/i\d+/)[0];
  run('add_cabinet', { kind: 'corner_base', at: 'w1' });
  run('add_cabinet', { kind: 'base', at: islandId });
  assert(p.cabinets[0].corner, 'corner base');
  assertEq(p.cabinets[1].at, islandId);
  run('update_settings', { changes: [{ path: 'frontStyle', value: 'shaker' }, { path: 'toeKickHeight', value: '100mm' }, { path: 'materials.case', value: 'baltic birch' }] });
  assertEq(p.construction.frontStyle, 'shaker');
  assertApprox(p.construction.toeKickHeight, 100);
  assertEq(p.construction.materials.case, 3);
  assert(buildAll(p).every((b) => b.cabinet), 'everything builds');
  assert(run('get_materials_report', {}).result.includes('Edge banding'));
});

test('ai tools: bad requests fail with a message and change nothing', () => {
  const p = emptyProject(defaultConstruction());
  runTool(p, buildAll(p), 'add_cabinet', { kind: 'base' });
  const before = JSON.stringify(p);
  toolFails(p, 'add_cabinet', { kind: 'shelf' }, /kind must be/);
  toolFails(p, 'add_cabinet', { kind: 'base', at: 'Wall 9' }, /No wall or island/);
  toolFails(p, 'update_cabinet', { id: 99, width: '600mm' }, /No cabinet with id 99/);
  toolFails(p, 'update_cabinet', { id: p.cabinets[0].id, width: 'wide' }, /not a length/);
  toolFails(p, 'update_settings', { changes: [{ path: 'toeKickHeight', value: '90mm' }, { path: 'hinge.k', value: 3 }] }, /can't be changed/);
  toolFails(p, 'update_cabinet', { id: p.cabinets[0].id, fronts: [{ type: 'shelf' }] }, /fronts\[0\]\.type/);
  assertEq(JSON.stringify(p), before, 'nothing changed');
});

// Runner
const out = document.getElementById('results');
let failed = 0;
for (const { name, fn } of tests) {
  const li = document.createElement('li');
  try {
    fn();
    li.textContent = `✓ ${name}`;
    li.className = 'pass';
  } catch (e) {
    failed++;
    li.textContent = `✗ ${name} — ${e.message}`;
    li.className = 'fail';
  }
  out.append(li);
}
const summary = `${failed ? 'FAIL' : 'PASS'} ${tests.length - failed}/${tests.length}`;
document.title = summary;
document.getElementById('summary').textContent = summary;
