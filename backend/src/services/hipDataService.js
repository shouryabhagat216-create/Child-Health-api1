const { createHash, randomUUID } = require('crypto');
const { createSender } = require('../abdm/fidelius');
const { toImmunizationBundle } = require('../fhir/mapper');
const { createMemoryStore } = require('../state/stateStore');

const KNOWN_STATUSES = ['GRANTED', 'REVOKED', 'EXPIRED', 'DENIED'];
const CARE_CONTEXT_REFERENCE = 'immunization-record';
const day = (iso) => String(iso).slice(0, 10);

// M2 as a HIP, consent and data flow: remember the consent decisions ABDM tells us about, and when a requester
// asks for records under a granted consent, encrypt a FHIR bundle for them and push it to their data push URL.
// Consents are kept in the shared state store (encrypted in the database). The consent artefact's signature is
// NOT verified here: the key for that is not published (confirm at onboarding). The FHIR is core R4 and has NOT
// been validated against the NRCeS profiles. The encryption is not yet proven against a real Fidelius peer.
function createHipDataService({ repo, hipClient, safePushUrl, store = createMemoryStore(), now = () => new Date(), log = (line) => console.warn(line) }) {
  const NS = 'hip-consent'; // consentId -> { status, hiTypes, from, to, eraseAt, childIds }
  const getConsent = (id) => store.get(NS, id);

  const effective = (c) => (c.status === 'GRANTED' && c.eraseAt && new Date(c.eraseAt) <= now() ? 'EXPIRED' : c.status);

  return {
    // Returns the acknowledgement body to send, or null when the notification is not one we act on.
    async onConsentNotify(hipId, body) {
      const n = body && body.notification;
      if (!n || !n.consentId || !KNOWN_STATUSES.includes(n.status)) return null; // refuse an unknown status instead of defaulting
      const detail = n.consentDetail || {};
      if (detail.hip && detail.hip.id && detail.hip.id !== hipId) return null;
      const range = (detail.permission && detail.permission.dateRange) || {};
      const previous = await getConsent(n.consentId);
      await store.put(NS, n.consentId, {
        status: n.status,
        hiTypes: detail.hiTypes || (previous && previous.hiTypes) || [],
        from: range.from || (previous && previous.from),
        to: range.to || (previous && previous.to),
        eraseAt: (detail.permission && detail.permission.dataEraseAt) || (previous && previous.eraseAt),
        childIds: (detail.careContexts || []).map((c) => c.patientReference).filter(Boolean).length
          ? [...new Set(detail.careContexts.map((c) => c.patientReference).filter(Boolean))]
          : (previous && previous.childIds) || [],
      });
      return { acknowledgement: { status: 'OK', consentId: n.consentId } };
    },

    // Decides on a health-information request. Returns { ok: true, push } or { ok: false, error }.
    // push() sends the records; call it AFTER the acknowledgement has been sent.
    async onHealthInformationRequest(hipId, body, requestId) {
      const hi = body && body.hiRequest;
      const consent = hi && hi.consent && (await getConsent(hi.consent.id));
      if (!consent || effective(consent) !== 'GRANTED') {
        return { ok: false, error: { code: 'ABDM-1062', message: 'Consent is not granted' } };
      }
      if (!consent.hiTypes.includes('ImmunizationRecord')) return { ok: false, error: { code: 'ABDM-1062', message: 'Consent does not cover ImmunizationRecord' } };
      const from = day(hi.dateRange && hi.dateRange.from) > day(consent.from) ? day(hi.dateRange.from) : day(consent.from);
      const to = day(hi.dateRange && hi.dateRange.to) < day(consent.to) ? day(hi.dateRange.to) : day(consent.to);
      if (!(hi.dateRange && hi.dateRange.from && hi.dateRange.to) || from > to) {
        return { ok: false, error: { code: 'ABDM-1063', message: 'Invalid date range' } };
      }
      let url;
      let sender;
      try {
        url = safePushUrl(hi.dataPushUrl);
        sender = createSender(hi.keyMaterial);
      } catch (err) {
        return { ok: false, error: { code: 'ABDM-9999', message: err.message || 'The request could not be processed' } };
      }
      const transactionId = body.transactionId;

      const push = async () => {
        const doneAt = () => now().toISOString();
        const notify = (sessionStatus, hiStatus, description) =>
          hipClient.notifyDataFlow({
            hipId,
            body: {
              notification: {
                consentId: hi.consent.id,
                transactionId,
                doneAt: doneAt(),
                notifier: { type: 'HIP', id: hipId },
                statusNotification: { sessionStatus, hipId, statusResponses: [{ careContextReference: CARE_CONTEXT_REFERENCE, hiStatus, description }] },
              },
            },
          });
        try {
          const entries = [];
          for (const childId of consent.childIds) {
            const child = await repo.findChildById(childId);
            // Sharing needs BOTH the ABDM consent and the guardian's own consent to WombTo18 processing.
            if (!child || child.consentStatus !== 'granted') continue;
            // Data minimisation: only completed vaccinations inside the consented date range.
            const immunizations = (await repo.listRemindersByChild(child.id)).filter(
              (r) => r.reminderStatus === 'completed' && r.dueDate >= from && r.dueDate <= to
            );
            const plain = JSON.stringify(toImmunizationBundle({ child, abhaNumberMasked: 'ABHA-linked', immunizations, now: now() }));
            entries.push({
              content: sender.encrypt(plain),
              media: 'application/fhir+json',
              checksum: createHash('md5').update(plain).digest('hex'), // MD5 of the content before encryption; hex vs base64 is not stated by the spec
              careContextReference: CARE_CONTEXT_REFERENCE,
            });
          }
          if (!entries.length) return notify('FAILED', 'ERRORED', 'No record could be shared');
          await hipClient.pushRecords(url, { pageNumber: 1, pageCount: 1, transactionId, entries, keyMaterial: sender.keyMaterial });
          return notify('TRANSFERRED', 'DELIVERED', 'Data sent successfully');
        } catch (err) {
          log(JSON.stringify({ level: 'error', event: 'data_push_failed', name: err.name, code: err.code || null, requestId }));
          return notify('FAILED', 'ERRORED', 'The records could not be delivered').catch(() => {});
        }
      };
      return { ok: true, push, transactionId: transactionId || randomUUID() };
    },

    consentStatus: async (consentId) => {
      const c = await getConsent(consentId);
      return c ? effective(c) : null;
    },
  };
}

module.exports = { createHipDataService };
