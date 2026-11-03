const fs = require('fs');

// Facility ids come from a git-ignored config file, never from code. A missing or unreadable file means
// "no facilities", so everything that depends on a facility fails closed.
// File shape: [{ "serviceId": "IN...", "hipName": "...", "type": "HIP" }, ...]
function loadFacilities(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list.filter((f) => f && typeof f.serviceId === 'string') : [];
  } catch {
    return [];
  }
}

const idsOf = (facilities, type) =>
  new Set(facilities.filter((f) => !type || (f.type || 'HIP') === type).map((f) => f.serviceId));

module.exports = { loadFacilities, idsOf };
