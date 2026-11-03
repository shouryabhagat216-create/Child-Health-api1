const { createHash } = require('crypto');

// Deterministic SYNTHETIC ABHA numbers: the same child id always gives the same number.
// They start with "00-", which is meant to look obviously fake. They are not real ABHA numbers.
const ABHA_FORMAT = /^\d{2}-\d{4}-\d{4}-\d{4}$/;

function syntheticAbhaFor(childId) {
  const digits = (BigInt(`0x${createHash('sha256').update(childId).digest('hex').slice(0, 16)}`) % 10n ** 12n)
    .toString()
    .padStart(12, '0');
  return `00-${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`;
}

// Responses and logs only ever show the masked form.
const maskAbha = (abhaNumber) => `**-****-****-${abhaNumber.slice(-4)}`;

const syntheticAbhaAddress = (childId) => `synthetic.${childId.slice(0, 8)}@sbx.mock`;

module.exports = { ABHA_FORMAT, syntheticAbhaFor, maskAbha, syntheticAbhaAddress };
