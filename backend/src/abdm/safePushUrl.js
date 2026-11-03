const net = require('net');
const { AppError } = require('../errors');

// The dataPushUrl arrives in a request from outside, so before we POST health records to it: https only, no
// credentials in the URL, a real host name (no IP literals, localhost or internal names), default port. This
// stops a forged request from pointing us at an internal service. It does not stop DNS that later resolves to a
// private address; resolve and re-check the address if the push is ever exposed beyond the sandbox.
function safePushUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, 'INVALID_DATA_PUSH_URL', 'The data push URL is not a valid URL');
  }
  const host = url.hostname.toLowerCase();
  const bad =
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    net.isIP(host.replace(/^\[|\]$/g, '')) ||
    host === 'localhost' ||
    !host.includes('.') ||
    /\.(local|internal|localhost|lan|home|corp)$/.test(host);
  if (bad) throw new AppError(400, 'INVALID_DATA_PUSH_URL', 'The data push URL is not an allowed https address');
  return url.toString();
}

module.exports = { safePushUrl };
