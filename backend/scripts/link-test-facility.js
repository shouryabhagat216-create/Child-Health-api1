// EXPERIMENT (sandbox only): try to link a TEST facility id to our bridge as a HIP or HIU, to see whether the
// sandbox accepts an id that is not in the Health Facility Registry. The current ABDM docs only describe
// linking a registered facility, so this may be refused; the answer is the point of running it.
//
//   node scripts/link-test-facility.js --facility IN0000000001 --name "WombTo18 Test" --hip WombTo18Test
//        -> dry run: validates the input and shows what ABDM holds now (changes nothing)
//   node scripts/link-test-facility.js ... --apply [--type HIU]
//        -> POST /v1/bridges/MutipleHRPAddUpdateServices on the sandbox registry, then lists the bridge
//
// Uses the app's own config. Prints statuses and ABDM's own words only: never the token, client id or secret.
// The bridge id sent is our client id (the sandbox's bridge id); it is not printed.
const { randomUUID } = require('crypto');
const config = require('../src/config');
const { createSandboxClient } = require('../src/abdm/sandboxClient');

const REGISTRY_HOST = 'apihspsbx.abdm.gov.in';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const apply = process.argv.includes('--apply');
const facilityId = arg('facility');
const facilityName = arg('name');
const hipName = arg('hip');
const type = (arg('type', 'HIP') || '').toUpperCase();

const problems = [];
if (!/^IN\d{10}$/.test(facilityId || '')) problems.push('--facility must be 12 characters: IN followed by 10 digits');
if (!/^[A-Za-z0-9][A-Za-z0-9 \-_.(),/]{0,59}$/.test(facilityName || '') || /\s{2}/.test(facilityName || '')) problems.push('--name must be letters, digits and - _ . ( ) , / with single spaces');
if (!/^[A-Za-z0-9]{1,15}$/.test(hipName || '')) problems.push('--hip must be 1 to 15 letters or digits, no spaces or symbols');
if (!['HIP', 'HIU'].includes(type)) problems.push('--type must be HIP or HIU');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

(async () => {
  const token = await createSandboxClient({ config: config.abdm }).getToken();
  const gateway = String(config.abdm.gatewayBaseUrl).replace(/\/$/, '');
  const headers = () => ({
    Authorization: `Bearer ${token}`,
    'REQUEST-ID': randomUUID(),
    TIMESTAMP: new Date().toISOString(),
    'X-CM-ID': config.abdm.cmId,
    'Content-Type': 'application/json',
  });
  const listed = async (label) => {
    const res = await fetch(`${gateway}/api/hiecm/gateway/v3/bridge-services`, { headers: headers() });
    const b = await res.json().catch(() => ({}));
    const names = Array.isArray(b.services) ? b.services.map((s) => `${s.id || s.serviceId}:${s.type || ''}${s.active === false ? '(inactive)' : ''}`) : [];
    console.log(`${label}: HTTP ${res.status} | services ${names.length}${names.length ? ' -> ' + names.join(', ') : ''}`);
  };

  console.log(`Plan: link ${facilityId} ("${facilityName}", shown to patients as "${hipName}") as ${type}`);
  await listed('before');
  if (!apply) return console.log('Dry run only. Add --apply to send it.');

  const res = await fetch(`https://${REGISTRY_HOST}/v4/int/v1/bridges/MutipleHRPAddUpdateServices`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ facilityId, facilityName, HRP: [{ bridgeId: config.abdm.clientId, hipName, type, active: true }] }),
  });
  const text = (await res.text()).replace(new RegExp(config.abdm.clientId, 'g'), '[bridge id]').slice(0, 400);
  console.log(`link call: HTTP ${res.status} ${text}`);
  await listed('after');
})().catch((e) => {
  console.error('failed:', e.code || e.message);
  process.exit(1);
});
