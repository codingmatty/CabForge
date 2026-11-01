// CabForge entry point: builds the layout once, then re-renders the panels
// from the state on every change.

import { renderCabinetDialog } from './ui/cabinetdialog.js';
import { renderChat } from './ui/chat.js';
import { renderCnc } from './ui/cnc.js';
import { download, gearIcon, h } from './ui/dom.js';
import { renderElevation } from './ui/elevation.js';
import { renderNesting } from './ui/nesting.js';
import { renderPartView } from './ui/partview.js';
import { renderPlan } from './ui/plan.js';
import { renderProjects, showProjects } from './ui/projects.js';
import { renderSettings } from './ui/settings.js';
import { renderSidebar } from './ui/sidebar.js';
import { renderSupplies } from './ui/supplies.js';
import { boot, select, setState, state, subscribe, updateProject } from './ui/store.js';
import { renderCutList, renderPartsTable } from './ui/tables.js';
import { Viewer3D } from './ui/viewer3d.js';
import { renderVisibility } from './ui/visibility.js';

const VIEWS = [
  ['3d', '3D'],
  ['plan', 'Plan'],
  ['elevation', 'Elevation'],
  ['part', 'Part drawing'],
  ['cutlist', 'Cut list'],
  ['nesting', 'Nesting'],
  ['cnc', 'CNC'],
  ['materials', 'Materials'],
];

// ---- layout (built once) -------------------------------------------------

const nameInput = h('input', {
  class: 'project-name',
  'aria-label': 'Project name',
  placeholder: 'No job open',
  onchange: (e) => updateProject((p) => (p.name = e.target.value.trim() || 'Untitled')),
});
const status = h('span', { class: 'save-status', role: 'status' });
const exportJson = () => {
  const p = state.project;
  download(`${p.name}.cabforge.json`, 'application/json', JSON.stringify(p, null, 2));
};

const chatButton = h('button', { class: 'chat-toggle', hidden: true, onclick: () => setState({ chatOpen: !state.chatOpen }), title: 'Design by chat' }, 'AI chat');
const topbar = h(
  'header',
  { class: 'topbar' },
  h('div', { class: 'brand' }, 'Cab', h('span', {}, 'Forge')),
  nameInput,
  status,
  h('div', { class: 'spacer' }),
  h('button', { onclick: showProjects }, 'Projects'),
  chatButton,
  h('button', { onclick: exportJson }, 'Export JSON'),
  h(
    'button',
    {
      class: 'icon-btn',
      'aria-label': 'Settings',
      title: 'Settings: materials and construction',
      onclick: () => setState({ settings: 'construction' }),
    },
    gearIcon(),
  ),
);

const sidebar = h('aside', { class: 'sidebar' });
const tabButtons = VIEWS.map(([id, label]) => h('button', { onclick: () => setState({ view: id }) }, label));
const viewer = new Viewer3D();
const visibilityRoot = h('div', { class: 'visibility' });
const panes = {
  '3d': h('div', { class: 'pane' }, viewer.element, visibilityRoot),
  plan: h('div', { class: 'pane plan-pane' }),
  elevation: h('div', { class: 'pane' }),
  part: h('div', { class: 'pane part' }),
  cutlist: h('div', { class: 'pane scroll' }),
  nesting: h('div', { class: 'pane scroll nesting' }),
  cnc: h('div', { class: 'pane scroll cnc' }),
  materials: h('div', { class: 'pane scroll supplies' }),
};
const bottom = h('div', { class: 'bottom' });
const settingsRoot = h('div');
const projectsRoot = h('div');
const cabDialogRoot = h('div');
const chatRoot = h('div', { class: 'chat-root' });
const appRoot = h('div', { class: 'app' });

document.getElementById('app').replaceChildren(
  (appRoot.append(
    topbar,
    sidebar,
    h(
      'main',
      { class: 'workspace' },
      h('nav', { class: 'tabs' }, tabButtons),
      h('div', { class: 'view' }, Object.values(panes)),
      bottom,
    ),
    chatRoot,
  ),
  appRoot),
  settingsRoot,
  projectsRoot,
  cabDialogRoot,
);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.settings || state.projectsOpen || state.cabDialog) setState({ settings: null, projectsOpen: false, cabDialog: null });
  // Otherwise Esc clears the selection (not while typing in a field).
  else if (!e.target.closest?.('input, select, textarea') && state.project?.cabinets[state.selected]) select(-1);
});

// ---- render ----------------------------------------------------------------

const STATUS_TEXT = { saved: 'Saved', saving: 'Saving…', error: 'Not saved' };

function render(opts) {
  if (!state.project) return;
  if (document.activeElement !== nameInput) nameInput.value = state.project.name;
  status.textContent = state.noJob ? '' : STATUS_TEXT[state.saveStatus];
  status.className = `save-status ${state.saveStatus}`;
  status.title = state.saveError ? `${state.saveError} — will retry` : '';

  VIEWS.forEach(([id], i) => {
    tabButtons[i].className = state.view === id ? 'active' : '';
    panes[id].hidden = state.view !== id;
  });

  chatButton.hidden = !state.ai?.enabled;
  chatButton.className = state.chatOpen ? 'chat-toggle active' : 'chat-toggle';
  appRoot.classList.toggle('chat-open', !!(state.chatOpen && state.ai?.enabled));
  renderChat(chatRoot);
  renderSidebar(sidebar);
  viewer.update();
  renderVisibility(visibilityRoot);
  if (state.view === 'plan') renderPlan(panes.plan);
  if (state.view === 'elevation') renderElevation(panes.elevation);
  if (state.view === 'part') renderPartView(panes.part);
  if (state.view === 'cutlist') renderCutList(panes.cutlist);
  if (state.view === 'nesting') renderNesting(panes.nesting);
  if (state.view === 'cnc') renderCnc(panes.cnc);
  if (state.view === 'materials') renderSupplies(panes.materials);
  renderPartsTable(bottom);
  if (!opts.skipSettings) renderSettings(settingsRoot);
  renderProjects(projectsRoot);
  renderCabinetDialog(cabDialogRoot);
}

subscribe(render);
boot();
