// Client for api.php.

const BASE = 'api.php';

async function call(method, params, body) {
  const url = `${BASE}?${new URLSearchParams(params)}`;
  const init = { method, headers: { 'X-CabForge': '1' }, cache: 'no-store' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const err = new Error(data?.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  health: () => call('GET', { action: 'health' }),
  getShop: () => call('GET', { action: 'shop' }).then((d) => d.shop),
  saveShop: (shop) => call('PUT', { action: 'shop' }, shop),
  getPrefs: () => call('GET', { action: 'prefs' }).then((d) => d.prefs),
  savePrefs: (prefs) => call('PUT', { action: 'prefs' }, prefs),
  listProjects: () => call('GET', { action: 'projects' }).then((d) => d.projects),
  getProject: (id) => call('GET', { action: 'project', id }).then((d) => d.project),
  saveProject: (project) => call('PUT', { action: 'project', id: project.id }, project),
  deleteProject: (id) => call('DELETE', { action: 'project', id }),
};
