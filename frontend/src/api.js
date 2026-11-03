// Small fetch wrapper. The login token is kept only in memory (a module variable), not in
// localStorage, so it cannot be read back by other scripts or survive a page reload.
// Trade-off: reloading the page logs you out. That is acceptable for a mock dashboard.
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

let token = null;
let listener = () => {};

export const setToken = (value) => {
  token = value;
};
export const onResponse = (fn) => {
  listener = fn;
};

// Never show the login token in the "last response" panel.
const redact = (data) => (data && data.token ? { ...data, token: '[hidden]' } : data);

export async function api(method, path, { body, scenario } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  // Only ABDM routes understand the mock-scenario header.
  if (scenario && scenario !== 'success' && path.startsWith('/abdm')) headers['X-Mock-Scenario'] = scenario;

  let result;
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    result = { ok: res.ok, status: res.status, data };
  } catch (err) {
    result = {
      ok: false,
      status: 0,
      data: { error: { code: 'NETWORK_ERROR', message: `Could not reach the API at ${BASE}. Is it running?` } },
    };
  }
  listener({ method, path, scenario: headers['X-Mock-Scenario'] || null, status: result.status, data: redact(result.data) });
  return result;
}
