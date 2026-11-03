#!/usr/bin/env node
// Bridge administration for the ABDM SANDBOX. Safe by default: it only PRINTS what it would send
// (without the token) unless you add --yes. Reading the services list is the only call that runs
// without --yes, because it changes nothing.
//
//   node scripts/abdm-bridge.js show
//   node scripts/abdm-bridge.js set-url https://your-tunnel.example.com [--yes]
//   node scripts/abdm-bridge.js add-hip <facilityKey> [--yes]
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { createSandboxClient } = require('../src/abdm/sandboxClient');
const { createBridgeAdmin } = require('../src/abdm/bridgeAdmin');

async function main() {
  const [command, arg] = process.argv.slice(2).filter((a) => a !== '--yes');
  const confirmed = process.argv.includes('--yes');

  if (config.abdm.mode !== 'sandbox') {
    console.error('Set ABDM_MODE=sandbox (with sandbox credentials) in backend/.env first.');
    process.exit(1);
  }
  const client = createSandboxClient({ config: config.abdm }); // checks credentials and sandbox host
  const admin = createBridgeAdmin({ config: config.abdm, client });

  let req;
  let readOnly = false;
  if (command === 'show') {
    req = admin.plan.getServices();
    readOnly = true;
  } else if (command === 'set-url') {
    req = admin.plan.setBridgeUrl(arg);
  } else if (command === 'add-hip') {
    const file = process.env.ABDM_FACILITIES_FILE || path.join(__dirname, '..', 'config', 'facilities.json');
    if (!fs.existsSync(file)) {
      console.error(`Facilities file not found: ${file}\nCopy config/facilities.example.json to config/facilities.json and fill it in.`);
      process.exit(1);
    }
    const facility = JSON.parse(fs.readFileSync(file, 'utf8')).facilities[arg];
    if (!facility) {
      console.error(`No facility '${arg}' in ${file}`);
      process.exit(1);
    }
    const publicBase = process.env.ABDM_PUBLIC_BASE_URL;
    if (!publicBase) {
      console.error('Set ABDM_PUBLIC_BASE_URL (your public https URL) in backend/.env first.');
      process.exit(1);
    }
    req = admin.plan.addHipService(facility, publicBase);
  } else {
    console.error('Usage: abdm-bridge.js show | set-url <https-url> [--yes] | add-hip <facilityKey> [--yes]');
    process.exit(1);
  }

  console.log('Request:', JSON.stringify(req, null, 2));
  if (!readOnly && !confirmed) {
    console.log('\nDRY RUN: nothing was sent. Add --yes to send this to the sandbox.');
    return;
  }
  const result = await admin.send(req);
  console.log(`\nSandbox replied: HTTP ${result.status}`);
  console.log(JSON.stringify(result.body, null, 2));
}

main().catch((err) => {
  // Only the safe, redacted fields we build ourselves.
  console.error(`Failed: ${err.code || err.name}: ${err.message}`, err.details ? JSON.stringify(err.details) : '');
  process.exit(1);
});
