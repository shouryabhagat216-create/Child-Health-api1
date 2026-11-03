const { randomUUID } = require('crypto');

// Builds a SYNTHETIC FHIR R4-shaped document Bundle (Composition + Patient + Organization +
// Immunization resources) from our own data.
//
// IMPORTANT: this follows the core FHIR R4 structure only. It does NOT set meta.profile and has NOT
// been validated against the ABDM FHIR Implementation Guide, so it must not be described as
// ABDM-profile compliant. The vaccine is carried as free text, with no invented vaccine codes.
const urn = (id) => `urn:uuid:${id}`;

function toImmunizationBundle({ child, abhaNumberMasked, immunizations, now = new Date() }) {
  const orgId = randomUUID();
  const compositionId = randomUUID();
  const timestamp = now.toISOString();

  const patient = {
    resourceType: 'Patient',
    id: child.id,
    // Masked only; the full ABHA number never leaves the system.
    identifier: [{ system: 'https://example.invalid/mock-abha', value: abhaNumberMasked }],
    name: [{ text: child.name }],
    birthDate: child.dateOfBirth,
    address: [{ state: child.state, country: 'IN' }],
  };

  const organization = {
    resourceType: 'Organization',
    id: orgId,
    name: 'WombTo18 (MOCK health information provider)',
  };

  const immunizationResources = immunizations.map((r) => ({
    resourceType: 'Immunization',
    id: r.id,
    status: 'completed',
    vaccineCode: { text: r.vaccineName },
    patient: { reference: urn(child.id) },
    // Simplification for the prototype: the reminder due date stands in for the date given.
    occurrenceDateTime: r.dueDate,
  }));

  const composition = {
    resourceType: 'Composition',
    id: compositionId,
    status: 'final',
    type: { text: 'Immunization record' },
    subject: { reference: urn(child.id) },
    date: timestamp,
    author: [{ reference: urn(orgId) }],
    title: 'Immunization record (synthetic MOCK data)',
    section: [
      {
        title: 'Immunizations',
        entry: immunizationResources.map((i) => ({ reference: urn(i.id) })),
      },
    ],
  };

  const entry = (resource) => ({ fullUrl: urn(resource.id), resource });
  return {
    resourceType: 'Bundle',
    id: randomUUID(),
    type: 'document',
    timestamp,
    entry: [composition, patient, organization, ...immunizationResources].map(entry),
  };
}

module.exports = { toImmunizationBundle };
