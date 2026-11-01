// Application state. The project is the single source of truth; built
// cabinets are recomputed from it on every edit, and every view re-renders
// from the state.

import { defaultConstruction, ensureBands, ensurePanelMaterial, stackFronts } from '../engine/model.js';
import { buildAll, emptyProject } from '../engine/project.js';
import { ensureRoom, locationById, locations } from '../engine/room.js';
import { setUnits } from '../engine/units.js';
import { api } from './api.js';

const CURRENT_KEY = 'cabforge.currentProject';
// Remembered instead of a project id when no job is open.
const NO_JOB = 'none';
const SAVE_DELAY_MS = 600;

export const state = {
  project: null,
  /** buildAll(project): one { cabinet } or { error } per cabinet. */
  built: [],
  /** Bumped on every project change so views can skip redundant work. */
  version: 0,
  selected: 0,
  selectedPart: null,
  view: '3d', // '3d' | 'plan' | 'elevation' | 'part' | 'cutlist' | 'nesting' | 'cnc' | 'materials'
  /** The wall or island being worked on (room.js location id): new
   *  cabinets go there and the elevation shows it. Follows the selection. */
  at: null,
  /** Part groups (see PART_GROUPS) hidden in the views. */
  hiddenGroups: new Set(),
  /** Individually hidden parts, keyed `${cabinet id}:${part index}`. */
  hiddenParts: new Set(),
  /** Show only the selected cabinet in 3D. */
  isolate: false,
  visibilityOpen: false,
  /** Cabinet dialog tab: null (closed) | 'cabinet' | 'construction'. */
  cabDialog: null,
  /** Part drawing of a case side: which holes to show, and the joining parts. */
  sideDrawing: { show: { hingePlate: true, slide: true, system: true }, joined: true },
  /** Bumped when anything above changes, so the 3D view rebuilds. */
  visibilityVersion: 0,
  settings: null, // null | 'construction' | 'materials' | 'edgeBanding' | 'cnc'
  projectsOpen: false,
  /** No job open: the project is an empty placeholder that becomes a new
   *  job (and is saved) on the first edit. */
  noJob: false,
  /** The shop's construction standards (library included) for new projects. */
  shop: defaultConstruction(),
  /** Shop-wide preferences: display units ('mm' | 'in') and the inch
   *  precision (8, 16, 32 = fractions; 0 = decimal). Saved apart from the
   *  shop's construction standards. */
  prefs: { units: 'mm', precision: 32 },
  saveStatus: 'saved', // 'saved' | 'saving' | 'error'
  saveError: '',
};

const listeners = new Set();
let pending = null;

/** Registers a render function; it receives the options of the change. */
export function subscribe(fn) {
  listeners.add(fn);
}

function notify(opts = {}) {
  // Coalesce several changes in the same tick into one render.
  if (pending) {
    pending.skipSettings &&= !!opts.skipSettings;
    return;
  }
  pending = { ...opts };
  // A new task (not a microtask): a change event fires during blur, and the
  // render must wait until focus has landed on the next field to keep it.
  setTimeout(() => {
    const o = pending;
    pending = null;
    for (const fn of listeners) fn(o);
  });
}

export function setState(patch) {
  Object.assign(state, patch);
  notify();
}

/** Mutates the project, rebuilds and schedules a save. Pass
 *  { skipSettings: true } for live edits (e.g. colour dragging) that must
 *  not rebuild the settings dialog under the user's pointer. */
export function updateProject(fn, opts = {}) {
  if (state.noJob) {
    // The first edit starts a new job.
    state.noJob = false;
    state.project.name ||= 'Untitled';
    rememberCurrent(state.project.id);
  }
  fn(state.project);
  rebuild();
  scheduleSave();
  notify(opts);
}

/** Applies a visibility change and re-renders. */
export function setVisibility(fn) {
  fn(state);
  state.visibilityVersion++;
  notify();
}

export const partKey = (spec, index) => `${spec.id}:${index}`;

export function select(index) {
  const at = state.project.cabinets[index]?.at;
  setState({ selected: index, selectedPart: null, ...(at ? { at } : {}) });
}

/** Selects cabinet `index`, or clears the selection when it is the
 *  selected one (a second click). */
export function toggleSelect(index) {
  select(index === state.selected ? -1 : index);
}

/** The current wall or island (see state.at), always one that exists. */
export function currentAt() {
  const p = state.project;
  if (state.at && locationById(p, state.at)) return state.at;
  return p.cabinets[state.selected]?.at ?? locations(p)[0].id;
}

function rebuild() {
  state.built = buildAll(state.project);
  state.version++;
}

// ---- persistence ---------------------------------------------------------

let saveTimer = null;
let lastShopJson = '';
// The open job's construction as last saved (or opened): only a change to it
// becomes the shop standard, so moving a cabinet doesn't overwrite shop
// defaults set on their own (e.g. US standard sizes).
let lastConstructionJson = '';

function scheduleSave() {
  clearTimeout(saveTimer);
  state.saveStatus = 'saving';
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

async function save() {
  saveTimer = null;
  const project = state.project;
  try {
    await api.saveProject(project);
    // Construction edits become the shop standard for new projects.
    const shopJson = JSON.stringify(project.construction);
    if (shopJson !== lastConstructionJson && shopJson !== lastShopJson) {
      await api.saveShop(project.construction);
      lastShopJson = shopJson;
      state.shop = JSON.parse(shopJson);
    }
    lastConstructionJson = shopJson;
    // A newer edit during the request has its own save queued.
    if (!saveTimer) state.saveStatus = 'saved';
    state.saveError = '';
  } catch (e) {
    state.saveStatus = 'error';
    state.saveError = e.message;
    // Retry later even if nothing else changes.
    if (!saveTimer) saveTimer = setTimeout(save, 5000);
  }
  notify({ skipSettings: true });
}

function rememberCurrent(id) {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    // storage unavailable: the app still works, it just won't reopen this project
  }
}

function recallCurrent() {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v));

export function newProjectId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Fills keys missing from older saves with current defaults. */
function withDefaults(value, defaults) {
  if (Array.isArray(defaults) || typeof defaults !== 'object' || defaults === null) {
    return value === undefined ? defaults : value;
  }
  const out = { ...defaults };
  for (const [k, v] of Object.entries(value ?? {})) {
    out[k] = k in defaults ? withDefaults(v, defaults[k]) : v;
  }
  return out;
}

// Settings older versions saved that no longer mean anything.
const OBSOLETE_CONSTRUCTION_KEYS = ['drawerSlideClearance', 'drawerSlideLengths', 'drawerBottomGroove', 'drawerBoxHeightReduction'];

function dropObsolete(c) {
  for (const k of OBSOLETE_CONSTRUCTION_KEYS) delete c[k];
  // Cups were drilled a fixed distance from the edge; now from hinge.k.
  delete c.hinge?.cupCenterFromEdge;
}

/** A saved construction with current defaults filled in, obsolete settings
 *  dropped and every material slot and band resolved. */
function upgradeConstruction(saved) {
  // A save from before the panel slot: the default's library id means
  // something else (or nothing) in its library.
  const noPanel = !!saved?.materials && !('panel' in saved.materials);
  const c = withDefaults(saved, defaultConstruction());
  if (noPanel) delete c.materials.panel;
  dropObsolete(c);
  ensurePanelMaterial(c);
  ensureBands(c);
  return c;
}

/** Older jobs chose one of a few front layouts; they are all stacks now. */
function stackAllFronts(project) {
  for (const spec of project.cabinets ?? []) {
    if (spec.fronts && spec.fronts.type !== 'stack' && !spec.corner) spec.fronts = stackFronts(spec);
  }
}

export function openProject(project) {
  project.construction = upgradeConstruction(project.construction);
  ensureRoom(project);
  stackAllFronts(project);
  state.project = project;
  lastConstructionJson = JSON.stringify(project.construction);
  state.selected = 0;
  state.at = null;
  state.selectedPart = null;
  state.noJob = false;
  rememberCurrent(project.id);
  rebuild();
  notify();
}

/** Starts a job with no cabinets. Pass { save: false } to keep it off the
 *  server until it is first edited. */
export function createProject({ save = true } = {}) {
  const p = emptyProject(clone(state.shop));
  p.id = newProjectId();
  openProject(p);
  if (save) scheduleSave();
}

/** Leaves the app with no job open: no cabinets, nothing saved. Adding a
 *  cabinet or naming the job starts a new one. */
export function clearProject() {
  const p = emptyProject(clone(state.shop));
  Object.assign(p, { id: newProjectId(), name: '' });
  openProject(p);
  state.noJob = true;
  rememberCurrent(NO_JOB);
}

/** Drops a queued save of the current project (it is being deleted). */
export function cancelSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  state.saveStatus = 'saved';
  state.saveError = '';
}

/** Changes the shop preferences (display units) and saves them. */
export async function setPrefs(patch) {
  state.prefs = { ...state.prefs, ...patch };
  applyPrefs();
  notify();
  try {
    await api.savePrefs(state.prefs);
  } catch (e) {
    state.saveStatus = 'error';
    state.saveError = e.message;
    notify({ skipSettings: true });
  }
}

function applyPrefs() {
  setUnits({ system: state.prefs.units, precision: state.prefs.precision });
}

/** Replaces the shop's construction standards (used by new jobs) and saves
 *  them; the open job is left as it is. */
export async function setShop(construction) {
  state.shop = construction;
  lastShopJson = JSON.stringify(construction);
  await api.saveShop(construction);
}

/** Loads the shop standards and the last opened project from the server. */
export async function boot() {
  try {
    const prefs = await api.getPrefs();
    if (prefs) state.prefs = { ...state.prefs, ...prefs };
  } catch {
    // keep mm: the shop load below reports a server that can't be reached
  }
  applyPrefs();
  try {
    const shop = await api.getShop();
    if (shop) {
      state.shop = upgradeConstruction(shop);
      lastShopJson = JSON.stringify(shop);
    }
  } catch (e) {
    state.saveStatus = 'error';
    state.saveError = e.message;
  }
  const id = recallCurrent();
  if (id === NO_JOB) {
    clearProject();
    return;
  }
  if (id) {
    try {
      openProject(await api.getProject(id));
      return;
    } catch {
      // deleted or unreachable: start a fresh one
    }
  }
  createProject();
}
