const { randomUUID } = require('crypto');
const { AppError } = require('../../errors');

// Outbound M2 calls as a HIP, to the ABDM gateway (sandbox: dev.abdm.gov.in). The REQUEST-ID is chosen by
// the caller so it can be registered BEFORE the call (the callback may arrive before the 202 returns).
// A 202 only means "received": the outcome arrives on our bridge.
const ALLOWED_GATEWAY_HOSTS = ['dev.abdm.gov.in'];

function createHipClient({ config, sandboxClient, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  let host;
  try {
    host = new URL(config.gatewayBaseUrl).host;
  } catch {
    throw new Error('ABDM_GATEWAY_BASE_URL is not a valid URL');
  }
  if (!ALLOWED_GATEWAY_HOSTS.includes(host)) throw new Error(`ABDM_GATEWAY_BASE_URL host '${host}' is not an allowed sandbox host`);
  const base = config.gatewayBaseUrl.replace(/\/$/, '');

  async function send(path, { body, hipId, hiuId, linkToken, requestId = randomUUID() }) {
    const token = await sandboxClient.getToken();
    const res = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'REQUEST-ID': requestId,
        TIMESTAMP: now().toISOString(),
        'X-CM-ID': config.cmId,
        ...(hipId ? { 'X-HIP-ID': hipId } : {}),
        ...(hiuId ? { 'X-HIU-ID': hiuId } : {}),
        ...(linkToken ? { 'X-LINK-TOKEN': linkToken } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { /* not json */ }
      const err = data.error && typeof data.error === 'object' ? data.error : data;
      throw new AppError(res.status >= 500 ? 502 : res.status, 'ABDM_REFUSED', err.message || 'ABDM refused the request', {
        abdmStatus: res.status,
        abdmCode: err.code,
        requestId,
      });
    }
    return { accepted: true, status: res.status, requestId };
  }

  return {
    generateLinkToken: (args) => send('/api/hiecm/v3/token/generate-token', args),
    linkCareContext: (args) => send('/api/hiecm/hip/v3/link/carecontext', args),
    notifyContextChange: (args) => send('/api/hiecm/hip/v3/link/context/notify', args),

    // Our answers to what ABDM asks of us. Each carries response.requestId = the REQUEST-ID of the request answered.
    onDiscover: (args) => send('/api/hiecm/user-initiated-linking/v3/patient/care-context/on-discover', args),
    onLinkInit: (args) => send('/api/hiecm/user-initiated-linking/v3/link/care-context/on-init', args),
    onLinkConfirm: (args) => send('/api/hiecm/user-initiated-linking/v3/link/care-context/on-confirm', args),
    onConsentNotify: (args) => send('/api/hiecm/consent/v3/request/hip/on-notify', args),
    onHealthInformationRequest: (args) => send('/api/hiecm/data-flow/v3/health-information/hip/on-request', args),
    notifyDataFlow: (args) => send('/api/hiecm/data-flow/v3/health-information/notify', args),

    // M3 as a HIU: ask for consent, track it, fetch each artefact, request the records, acknowledge a notification.
    consentInit: (args) => send('/api/hiecm/consent/v3/request/init', args),
    consentStatus: (args) => send('/api/hiecm/consent/v3/request/status', args),
    consentFetch: (args) => send('/api/hiecm/consent/v3/fetch', args),
    requestHealthInformation: (args) => send('/api/hiecm/data-flow/v3/health-information/request', args),
    onHiuConsentNotify: (args) => send('/api/hiecm/consent/v3/request/hiu/on-notify', args),

    // The records go straight to the requester's dataPushUrl, not through the gateway. The gateway token is
    // mandatory on this call. The URL is checked by the caller (see safePushUrl).
    async pushRecords(url, body) {
      const token = await sandboxClient.getToken();
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
      });
      if (res.status !== 202 && !res.ok) throw new AppError(502, 'DATA_PUSH_REFUSED', 'The requester did not accept the records', { status: res.status });
      return { status: res.status };
    },
  };
}

module.exports = { createHipClient, ALLOWED_GATEWAY_HOSTS };
