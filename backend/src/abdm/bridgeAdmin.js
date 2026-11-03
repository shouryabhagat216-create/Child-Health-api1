const { AppError } = require('../errors');

// Admin calls that tell the ABDM SANDBOX where our callbacks live and which HIP service we run.
// Paths come from the integration team's instructions:
//   PATCH {base}/gateway/v1/bridges                      body { url }
//   POST  {base}/gateway/v1/bridges/addUpdateServices    body [ { id, name, type, active, alias, endpoints } ]
//   GET   {base}/gateway/v1/bridges/getServices
// Their examples show no auth header. The gateway session token is sent as a Bearer token (as the
// official docs describe for other calls) together with X-CM-ID. That is an ASSUMPTION; the
// sandbox response will confirm it.
//
// Nothing here hardcodes a facility: ids, names and aliases come from a config file.

const HIP_NAME_RULE = /^[A-Za-z0-9]{1,15}$/; // official M4 page: at most 15 characters, no special characters

function validatePublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, 'INVALID_BRIDGE_URL', 'The bridge URL is not a valid URL');
  }
  const host = url.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
  if (url.protocol !== 'https:' || isLocal) {
    throw new AppError(400, 'INVALID_BRIDGE_URL', 'The bridge URL must be a public https URL (not localhost)');
  }
  return url.origin + url.pathname.replace(/\/$/, '');
}

function buildHipService(facility, publicBaseUrl) {
  const problems = [];
  if (!facility.serviceId) problems.push('serviceId is required');
  if (!HIP_NAME_RULE.test(facility.hipName || '')) problems.push('hipName must be 1 to 15 letters or digits');
  if (problems.length) throw new AppError(400, 'INVALID_FACILITY_CONFIG', problems.join('; '));
  const base = validatePublicUrl(publicBaseUrl);
  return {
    id: facility.serviceId,
    name: facility.hipName,
    type: facility.type || 'HIP',
    active: true,
    alias: facility.alias && facility.alias.length ? facility.alias : [facility.hipName.toLowerCase()],
    endpoints: [{ address: facility.endpointAddress || base, connectionType: 'https', use: 'registration' }],
  };
}

function createBridgeAdmin({ config, client, fetchImpl = globalThis.fetch }) {
  const base = config.gatewayBaseUrl.replace(/\/$/, '');

  // The request is described first, so it can be shown (without the token) before anything is sent.
  const describe = (method, path, body) => ({ method, url: `${base}${path}`, body });

  async function send(req) {
    const token = await client.getToken();
    const res = await fetchImpl(req.url, {
      method: req.method,
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-CM-ID': config.cmId,
      },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
    return { status: res.status, ok: res.ok, body };
  }

  return {
    plan: {
      getServices: () => describe('GET', '/gateway/v1/bridges/getServices'),
      setBridgeUrl: (url) => describe('PATCH', '/gateway/v1/bridges', { url: validatePublicUrl(url) }),
      addHipService: (facility, publicBaseUrl) =>
        describe('POST', '/gateway/v1/bridges/addUpdateServices', [buildHipService(facility, publicBaseUrl)]),
    },
    send,
  };
}

module.exports = { createBridgeAdmin, validatePublicUrl, buildHipService, HIP_NAME_RULE };
