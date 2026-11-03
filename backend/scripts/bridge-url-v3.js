// Shows, and with --apply sets, the bridge callback URL on the ABDM SANDBOX gateway (V3 API).
//   node scripts/bridge-url-v3.js            -> read only: compares ABDM's URL with ABDM_PUBLIC_BASE_URL
//   node scripts/bridge-url-v3.js --apply    -> PATCH /api/hiecm/gateway/v3/bridge/url, then re-checks
// Uses the same config and sandbox client as the app. Prints hosts and statuses only: never the token,
// the client id or the client secret. Refuses anything but the sandbox gateway host.
const { randomUUID } = require('crypto');
const config = require('../src/config');
const { createSandboxClient } = require('../src/abdm/sandboxClient');

const apply = process.argv.includes('--apply');
const host = (u) => { try { return new URL(u).host; } catch { return String(u); } };
const norm = (u) => String(u || '').replace(/\/$/, '');

(async () => {
  const wanted = norm(process.env.ABDM_PUBLIC_BASE_URL);
  if (!wanted.startsWith('https://')) throw new Error('ABDM_PUBLIC_BASE_URL must be set to an https:// address');

  const token = await createSandboxClient({ config: config.abdm }).getToken();
  const base = norm(config.abdm.gatewayBaseUrl);
  const headers = () => ({
    Authorization: `Bearer ${token}`,
    'REQUEST-ID': randomUUID(),
    TIMESTAMP: new Date().toISOString(),
    'X-CM-ID': config.abdm.cmId,
    'Content-Type': 'application/json',
  });
  const show = async (label) => {
    const res = await fetch(`${base}/api/hiecm/gateway/v3/bridge-services`, { headers: headers() });
    const body = await res.json().catch(() => ({}));
    const url = body.bridge && body.bridge.url;
    console.log(`${label}: HTTP ${res.status} | ABDM holds host ${url ? host(url) : '(none)'} | active ${body.bridge && body.bridge.active} | services ${Array.isArray(body.services) ? body.services.length : '?'}`);
    return norm(url) === wanted;
  };

  console.log(`We want host ${host(wanted)}`);
  const same = await show('before');
  if (!apply) {
    console.log(same ? 'Already set. Nothing to do.' : 'Different. Run again with --apply to set it.');
    return;
  }
  if (same) return console.log('Already set. Nothing changed.');

  const res = await fetch(`${base}/api/hiecm/gateway/v3/bridge/url`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ url: wanted }) });
  console.log(`PATCH bridge/url: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  console.log((await show('after')) ? 'Done: ABDM now holds our address.' : 'ABDM still holds a different address.');
})().catch((e) => { console.error('failed:', e.code || e.message); process.exit(1); });
