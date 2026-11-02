// Settings for the cabinet styles: frameless or face frame, overlay or inset
// fronts, the face frame itself, the solid wood it is made from and the
// hinges the inset and face-frame styles use.

import {
  CABINET_STYLES,
  HINGE_BRANDS,
  HINGE_TYPES,
  JOINERY,
  applyHingeBrand,
  blindDepth,
  caseT,
  frameThickness,
  isFaceFrame,
  isInset,
} from '../engine/model.js';
import { refitFronts } from '../engine/project.js';
import { checkboxField, h, lenInput, numField, selectField, textField } from './dom.js';
import { fmtLen, fmtLenU } from '../engine/units.js';
import { conCost, conNum, editConstruction, metricHeading } from './settings.js';
import { updateProject } from './store.js';

/** A construction change that moves the fronts: drawer-unit stacks are
 *  refitted to the new space (refitFronts). */
export function editFronts(fn) {
  updateProject((p) => {
    const before = structuredClone(p.construction);
    fn(p.construction);
    refitFronts(p, before);
  });
}

const frontNum = (c, label, key, get, set) => conNum(c, label, key, get, set, { metric: false });

/** The style select and the gaps that go with it. */
function styleSection(c) {
  const ff = isFaceFrame(c);
  const notes = {
    frameless: 'Frameless (32 mm system): the fronts cover the case edges, with the reveals and gaps on Sizes & fronts.',
    framelessInset: 'Frameless with the fronts set into the case, flush with its front edges. Shelves, dividers and drawer boxes move back by the front thickness.',
    faceFrameInset: 'A solid wood face frame on the case with the fronts set into its openings, flush with its face.',
    faceFrameOverlay: 'A solid wood face frame on the case with the fronts on its face, lapping onto the frame. Pairs of doors meet in the middle (no middle stile).',
  };
  return h(
    'section',
    {},
    h('h3', {}, 'Cabinet style'),
    h(
      'div',
      { class: 'fields' },
      selectField('Style', 'cabinetStyle', Object.entries(CABINET_STYLES), c.cabinetStyle, (v) => editFronts((c) => (c.cabinetStyle = v)), { wide: true }),
      isInset(c) ? frontNum(c, 'Gap around inset fronts', 'insetGap', (c) => c.insetGap, (c, v) => (c.insetGap = Math.max(0, v))) : null,
      c.cabinetStyle === 'faceFrameOverlay' ? frontNum(c, 'Overlay onto the frame', 'frameOverlay', (c) => c.frameOverlay, (c, v) => (c.frameOverlay = Math.max(0, v))) : null,
    ),
    h('p', { class: 'muted' }, notes[c.cabinetStyle] ?? ''),
    h(
      'p',
      { class: 'muted' },
      'Any cabinet can use another style (its ⚙ → Construction). Changing the style refits drawer stacks sized in units to the room the new style leaves.' +
        (ff ? ' Corner cabinets (L and 45°) stay frameless; use a blind corner in a face-frame job.' : ''),
    ),
  );
}

/** Rails, scribe, joints and wood of the face frames. */
function faceFrameSection(c) {
  const ff = c.faceFrame;
  const set = (key, min = 0) => (c, v) => (c.faceFrame[key] = Math.max(min, v));
  const woods = (c.woods ?? []).map((w) => [w.id, `${w.name} ${fmtLen(w.thickness)}`]);
  const t = caseT(c);
  return h(
    'section',
    {},
    h('h3', {}, 'Face frames'),
    h(
      'div',
      { class: 'fields' },
      frontNum(c, 'Top rail', 'ffTop', (c) => c.faceFrame.topRail, set('topRail', 10)),
      frontNum(c, 'Bottom rail', 'ffBottom', (c) => c.faceFrame.bottomRail, set('bottomRail', 10)),
      frontNum(c, 'Rails between fronts', 'ffMid', (c) => c.faceFrame.midRail, set('midRail', 5)),
      frontNum(c, 'Scribe at run ends', 'ffScribe', (c) => c.faceFrame.scribe, set('scribe')),
      selectField('Wood', 'ffWood', woods.length ? woods : [[0, 'None (add one under Solid wood)']], ff.wood, (v) => editConstruction((c) => (c.faceFrame.wood = Number(v)))),
      selectField('Joints', 'ffJoinery', Object.entries(JOINERY), ff.joinery, (v) => editConstruction((c) => (c.faceFrame.joinery = v))),
      ff.joinery === 'mortise' ? frontNum(c, 'Tenon length', 'ffTenon', (c) => c.faceFrame.tenon, set('tenon')) : null,
      ff.joinery === 'dowel'
        ? [
            numField('Dowels per joint', 'ffDowels', ff.dowels, (v) => editConstruction((c) => (c.faceFrame.dowels = Math.max(1, Math.round(v)))), { step: 1, format: String }),
            frontNum(c, 'Dowel diameter', 'ffDowelD', (c) => c.faceFrame.dowelDiameter, set('dowelDiameter', 1)),
          ]
        : null,
      checkboxField('One frame along a run', 'ffContinuous', ff.continuous, (v) => editConstruction((c) => (c.faceFrame.continuous = v))),
    ),
    h(
      'p',
      { class: 'muted' },
      `${fmtLenU(frameThickness(c))} thick (the wood's). Stiles are flush with the inside of the case: ${fmtLenU(2 * t)} between two cabinets (two ${fmtLenU(t)} sides), ` +
        `wider over a filler, and ${fmtLenU(t + ff.scribe)} at the open end of a run along a wall (a side and the scribe). ` +
        'Rails run between the stiles; the bottom rail is flush with the top of the case bottom, which is raised to meet it. ' +
        (ff.continuous
          ? 'Cabinets side by side at the same height share one frame, broken at appliances, frameless cabinets, height changes and wherever a cabinet asks for a break after it (its ⚙).'
          : 'Each cabinet has its own frame; where two meet, their stiles butt together.'),
    ),
  );
}

/** One style's hinge: concealed or butt, and its numbers. */
function styleHingeSection(c, style) {
  const hg = c.styleHinges?.[style];
  if (!hg) return null;
  const set = (key, min = 0) => (c, v) => (c.styleHinges[style][key] = Math.max(min, v));
  const euro = hg.type !== 'butt';
  const key = (k) => `sh-${style}-${k}`;
  return h(
    'section',
    {},
    metricHeading(`Hinges: ${CABINET_STYLES[style].toLowerCase()}`),
    h(
      'div',
      { class: 'fields' },
      // Butt hinges only make sense where the door sits in an opening.
      style === 'faceFrameOverlay'
        ? null
        : selectField('Type', key('type'), Object.entries(HINGE_TYPES), hg.type, (v) => editConstruction((c) => (c.styleHinges[style].type = v))),
      euro
        ? [
            textField('Hinge', key('name'), hg.name, (v) => editConstruction((c) => (c.styleHinges[style].name = v.trim() || hg.name)), { wide: true }),
            conNum(c, 'K (edge to cup)', key('k'), (c) => c.styleHinges[style].k, set('k'), { metric: true }),
            conNum(c, 'Cup depth', key('cupDepth'), (c) => c.styleHinges[style].cupDepth, set('cupDepth', 1), { metric: true }),
            conNum(c, 'Hinge from door end', key('end'), (c) => c.styleHinges[style].endOffset, set('endOffset', 35), { metric: true }),
            conCost(c, '$ / hinge', key('cost'), (c) => c.styleHinges[style].cost, (c, v) => (c.styleHinges[style].cost = v)),
            conCost(c, '$ / plate', key('plateCost'), (c) => c.styleHinges[style].plateCost, (c, v) => (c.styleHinges[style].plateCost = v)),
          ]
        : [
            textField('Hinge', key('buttName'), hg.buttName, (v) => editConstruction((c) => (c.styleHinges[style].buttName = v.trim() || hg.buttName)), { wide: true }),
            conNum(c, 'Leaf length', key('buttLength'), (c) => c.styleHinges[style].buttLength, set('buttLength', 10)),
            conNum(c, 'Hinge from door end', key('end'), (c) => c.styleHinges[style].endOffset, set('endOffset', 35), { metric: true }),
            conCost(c, '$ / hinge', key('buttCost'), (c) => c.styleHinges[style].buttCost, (c, v) => (c.styleHinges[style].buttCost = v)),
          ],
    ),
    h(
      'p',
      { class: 'muted' },
      euro
        ? `35 mm cups ${hg.cupDepth} mm deep, centred ${hg.k + 17.5} mm from the hinge edge (K ${hg.k}). ` +
            (style === 'framelessInset'
              ? 'The mounting plate screws to the side on the 32 mm line measured from the back of the door (37 + the door thickness from the case front).'
              : 'The mounting plate screws to the face frame; nothing is bored in the case.')
        : 'Mortised into the door edge and the frame or case by hand: the part drawings mark where, nothing is bored.',
    ),
  );
}

/** The hinge catalogue for the inset and face-frame styles, then each style's hinge. */
export function styleHingeSections(c) {
  return [
    h(
      'section',
      {},
      h('h3', {}, 'Inset & face-frame hinges'),
      h(
        'div',
        { class: 'fields' },
        selectField('Fill in from', 'hingeBrand', Object.entries(HINGE_BRANDS), c.hingeBrand, (v) => editConstruction((c) => applyHingeBrand(c, v))),
      ),
      h(
        'p',
        { class: 'muted' },
        'Picking a maker fills in its hinges for frameless inset, face-frame inset and face-frame overlay doors (prices and butt hinges are kept); each can then be changed. ' +
          'The numbers come from the makers’ and dealers’ published listings: check them against the instructions that come with your hinges before boring doors.',
      ),
    ),
    ['framelessInset', 'faceFrameInset', 'faceFrameOverlay'].map((style) => styleHingeSection(c, style)),
  ];
}

/** The solid wood list (face frames). */
export function woodsSection(c) {
  const woods = c.woods ?? [];
  const editWood = (id, fn) => editConstruction((c) => fn(c.woods.find((w) => w.id === id)));
  const cell = (w, field, label, opts) =>
    h('td', { class: 'num' }, h('input', lenInput(w[field], (v) => editWood(w.id, (w) => (w[field] = Math.max(1, v))), { key: `wood${w.id}-${field}`, 'aria-label': label, ...opts })));
  const plain = (w, field, label, { min = 0, step = 1, digits = 0 } = {}) =>
    h(
      'td',
      { class: 'num' },
      h('input', {
        type: 'number',
        min,
        step,
        'aria-label': label,
        'data-key': `wood${w.id}-${field}`,
        value: w[field] ? (digits ? w[field].toFixed(digits) : w[field]) : digits ? '' : 0,
        placeholder: digits ? '0.00' : null,
        onchange: (e) => {
          const v = e.target.value.trim() === '' ? 0 : parseFloat(e.target.value);
          if (Number.isFinite(v)) editWood(w.id, (w) => (w[field] = Math.max(min, v)));
        },
      }),
    );
  const add = () =>
    editConstruction((c) => {
      const id = (c.woods ?? []).reduce((m, w) => Math.max(m, w.id), 0) + 1;
      c.woods = [...(c.woods ?? []), { id, name: 'New wood', thickness: 19.05, quarters: 4, cost: 0, waste: 20, color: '#d8c39a' }];
    });
  return h(
    'section',
    {},
    h('h3', {}, 'Solid wood'),
    h(
      'table',
      { class: 'lib-table' },
      h('thead', {}, h('tr', {}, ['', 'Name', 'Thickness', 'Rough (quarters)', '$ / bd ft', 'Waste %', ''].map((t) => h('th', {}, t)))),
      h(
        'tbody',
        {},
        woods.map((w) => {
          const used = c.faceFrame?.wood === w.id;
          return h(
            'tr',
            {},
            h('td', {}, h('input', { type: 'color', 'aria-label': 'Colour', 'data-key': `wood${w.id}-color`, value: w.color, oninput: (e) => editWood(w.id, (w) => (w.color = e.target.value)) })),
            h('td', {}, h('input', { 'aria-label': 'Name', 'data-key': `wood${w.id}-name`, value: w.name, onchange: (e) => editWood(w.id, (w) => (w.name = e.target.value.trim() || w.name)) })),
            cell(w, 'thickness', 'Thickness', { step: 0.5 }),
            plain(w, 'quarters', 'Rough thickness in quarters', { min: 1 }),
            plain(w, 'cost', 'Price per board foot', { step: 0.01, digits: 2 }),
            plain(w, 'waste', 'Waste allowance %'),
            h(
              'td',
              {},
              h(
                'button',
                {
                  class: 'danger',
                  disabled: used,
                  title: used ? 'The face frames use it: pick another wood on Cabinet style first' : 'Delete wood',
                  'aria-label': `Delete ${w.name}`,
                  onclick: () => editConstruction((c) => (c.woods = c.woods.filter((x) => x.id !== w.id))),
                },
                '×',
              ),
            ),
          );
        }),
      ),
    ),
    h('div', { class: 'add-row' }, h('button', { onclick: add }, '+ Wood')),
    h(
      'p',
      { class: 'muted' },
      'Face frames are cut from solid wood: their stiles and rails get their own section of the cut list and are not nested on sheets. ' +
        'The Materials report counts board feet of rough stock (length × width × quarters ÷ 4, in inches, ÷ 144), plus the waste allowance, at the price per board foot.',
    ),
  );
}

/** Blind corner cabinets: the clearance that sizes their blind part. */
export function blindSection(c) {
  return h(
    'section',
    {},
    h('h3', {}, 'Blind corner'),
    h('div', { class: 'fields' }, frontNum(c, 'Door & pull clearance', 'blindClear', (c) => c.blindClearance, (c, v) => (c.blindClearance = Math.max(0, v)))),
    h(
      'p',
      { class: 'muted' },
      `A plain box at the end of a wall that runs into the corner; the next wall's cabinets stand in front of its blind end. ` +
        `The blind part is their depth and fronts plus this clearance (${fmtLen(blindDepth(c, 'base'))} for a base), covered by a wide stile or a blind panel. ` +
        'Each blind corner can change its own (its ⚙).',
    ),
  );
}

/** The Cabinet style page. */
export function styleSections(c) {
  return [styleSection(c), faceFrameSection(c)];
}
