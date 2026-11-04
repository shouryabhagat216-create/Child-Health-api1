const { randomUUID, randomBytes, createHash } = require('crypto');
const { AppError } = require('../errors');
const { findOwnedChild } = require('./ownership');
const { createReceiver } = require('../abdm/fidelius');
const { createMemoryStore } = require('../state/stateStore');
const { PURPOSES, HI_TYPES } = require('../abdm/constants');

const PURPOSE_TEXT = { CAREMGT: 'Care Management', PUBHLTH: 'Public Health', HPAYMT: 'Healthcare Payment' };
const PUSH_TTL_MS = 60 * 60 * 1000;
const KNOWN_STATUSES = ['GRANTED', 'EXPIRED', 'DENIED', 'REQUESTED', 'REVOKED'];

// M3 as a HIU: ask a patient (by ABHA address) for consent to read records held elsewhere, collect EVERY consent
// artefact id (one per HIP), fetch each artefact, request the records it covers, and receive, decrypt and check
// what the HIP pushes to our data push URL. State is kept in the shared state store (encrypted in the database;
// the receive key pair is stored as key material, not as an object). Records received are kept only until the artefact's dataEraseAt and are dropped when the consent is
// revoked. The consent artefact signature is NOT verified (the key is not published). The encryption is not yet
// proven against a real Fidelius peer.
function createHiuService({ repo, hipClient, pending, facilities, publicBaseUrl, store = createMemoryStore(), now = () => new Date(), defer = (fn) => { setImmediate(fn); }, log = (line) => console.warn(line) }) {
  // All plain JSON. requests: localId -> { localId, childId, abdmId, abhaAddress, status, artefacts: { id: artefact }, error }
  // transactions: pushToken -> { localId, artefactId, receiver (key material), transactionId, pages: [n], pageCount, records, status, expiresAt }
  // received: childId -> [ record ]
  const getRequest = (id) => store.get('hiu-request', id);
  const saveRequest = (r) => store.put('hiu-request', r.localId, r);
  const getTx = (token) => store.get('hiu-push', token);
  const saveTx = (token, tx) => store.put('hiu-push', token, tx, { ttlMs: Math.max(1000, tx.expiresAt - now().getTime()) });
  const getReceived = async (childId) => (await store.get('hiu-records', childId)) || [];
  const saveReceived = (childId, list) => store.put('hiu-records', childId, list);
  const allRequests = async () => (await store.list('hiu-request')).map((e) => e.value);

  const hiuId = () => {
    const f = facilities().find((x) => x.type === 'HIU');
    if (!hiuClientReady()) throw new AppError(409, 'SANDBOX_NOT_ENABLED', 'Set ABDM_MODE=sandbox (with sandbox credentials) in .env and restart');
    if (!f) throw new AppError(409, 'NO_HIU_FACILITY', 'No HIU facility is configured: add one to the facilities file (a registered facility id linked to the bridge as HIU)');
    return f.serviceId;
  };
  const hiuClientReady = () => Boolean(hipClient);

  const byAbdmId = async (abdmId) => (await allRequests()).find((r) => r.abdmId === abdmId);
  const ownedRequest = async (childId, guardianId, localId) => {
    await findOwnedChild(repo, childId, guardianId);
    const r = await getRequest(localId);
    if (!r || r.childId !== childId) throw new AppError(404, 'CONSENT_REQUEST_NOT_FOUND', `Consent request '${localId}' does not exist`);
    return r;
  };
  const view = (r) => ({
    id: r.localId, status: r.status, abdmConsentRequestId: r.abdmId, error: r.error,
    artefacts: Object.values(r.artefacts).map((a) => ({ id: a.id, status: a.status, fetched: a.fetched, hipId: a.hipId || null, error: a.error || null })),
  });
  const purge = async (childId) => {
    const list = (await getReceived(childId)).filter((rec) => !rec.eraseAt || new Date(rec.eraseAt) > now());
    await saveReceived(childId, list);
    return list;
  };

  async function requestRecords(artefact, request) {
    const publicBase = publicBaseUrl();
    if (!/^https:\/\//.test(publicBase)) throw new AppError(409, 'NO_PUBLIC_URL', 'ABDM_PUBLIC_BASE_URL must be set to the public https address of this server');
    const receiver = createReceiver();
    const pushToken = randomBytes(24).toString('hex'); // capability in the URL: only this transfer can use it
    await saveTx(pushToken, { localId: request.localId, artefactId: artefact.id, receiver: receiver.serialize(), transactionId: null, pages: [], pageCount: null, records: [], status: 'REQUESTED', expiresAt: now().getTime() + PUSH_TTL_MS });
    const requestId = randomUUID();
    await pending.add(requestId, { kind: 'hi-request', pushToken });
    try {
      await hipClient.requestHealthInformation({
        requestId,
        hiuId: hiuId(),
        body: {
          hiRequest: {
            consent: { id: artefact.id },
            dateRange: artefact.dateRange,
            dataPushUrl: `${publicBase}/api/v3/hiu/data-push/${pushToken}`,
            keyMaterial: { ...receiver.keyMaterial, curve: 'curve25519' },
          },
        },
      });
    } catch (err) {
      await pending.take(requestId);
      await store.del('hiu-push', pushToken);
      throw err;
    }
  }

  return {
    async requestConsent(childId, guardianId, input) {
      const child = await findOwnedChild(repo, childId, guardianId);
      const facility = hiuId();
      if (!PURPOSES.includes(input.purposeCode)) throw new AppError(400, 'INVALID_PURPOSE', `purposeCode must be one of: ${PURPOSES.join(', ')}`);
      const localId = randomUUID();
      const requestId = randomUUID();
      await saveRequest({ localId, childId, abdmId: null, abhaAddress: input.abhaAddress, status: 'WAITING_FOR_CALLBACK', artefacts: {}, error: null });
      await pending.add(requestId, { kind: 'consent-init', localId });
      try {
        await hipClient.consentInit({
          requestId,
          body: {
            consent: {
              purpose: { text: PURPOSE_TEXT[input.purposeCode], code: input.purposeCode },
              patient: { id: input.abhaAddress },
              hip: null,
              hiu: { id: facility },
              requester: { name: child.guardianName },
              hiTypes: HI_TYPES,
              permission: {
                accessMode: 'VIEW',
                dateRange: { from: `${input.dateFrom}T00:00:00.000Z`, to: `${input.dateTo}T23:59:59.999Z` },
                dataEraseAt: input.dataEraseAt,
                frequency: { unit: 'HOUR', value: 1, repeats: 0 },
              },
            },
          },
        });
      } catch (err) {
        await pending.take(requestId);
        await store.del('hiu-request', localId);
        throw err;
      }
      return { id: localId, status: 'WAITING_FOR_CALLBACK' };
    },

    async list(childId, guardianId) {
      await findOwnedChild(repo, childId, guardianId);
      return { consentRequests: (await allRequests()).filter((r) => r.childId === childId).map(view) };
    },

    async refreshStatus(childId, guardianId, localId) {
      const r = await ownedRequest(childId, guardianId, localId);
      if (!r.abdmId) throw new AppError(409, 'CONSENT_REQUEST_NOT_CONFIRMED', 'ABDM has not confirmed this consent request yet');
      const requestId = randomUUID();
      await pending.add(requestId, { kind: 'consent-status', localId });
      try {
        await hipClient.consentStatus({ requestId, hiuId: hiuId(), body: { consentRequestId: r.abdmId } });
      } catch (err) {
        await pending.take(requestId);
        throw err;
      }
      return { requested: true };
    },

    // Fetches EVERY granted artefact of the request (plural: one per HIP); the records are requested as each
    // artefact arrives.
    async fetchRecords(childId, guardianId, localId) {
      const r = await ownedRequest(childId, guardianId, localId);
      const granted = Object.values(r.artefacts).filter((a) => a.status === 'GRANTED');
      if (!granted.length) throw new AppError(409, 'NO_GRANTED_ARTEFACT', 'There is no granted consent artefact to fetch yet');
      const facility = hiuId();
      for (const a of granted) {
        const requestId = randomUUID();
        await pending.add(requestId, { kind: 'consent-fetch', localId, artefactId: a.id });
        try {
          await hipClient.consentFetch({ requestId, hiuId: facility, body: { consentId: a.id } });
        } catch (err) {
          await pending.take(requestId);
          throw err;
        }
      }
      return { fetching: granted.map((a) => a.id) };
    },

    async records(childId, guardianId) {
      await findOwnedChild(repo, childId, guardianId);
      return { records: await purge(childId) };
    },

    // ---- callbacks: answers to our calls ----
    async onConsentInit(entry, body) {
      const r = await getRequest(entry.localId);
      if (!r) return;
      if (body.error || !body.consentRequest || !body.consentRequest.id) {
        r.status = 'FAILED';
        r.error = body.error ? { code: body.error.code, message: body.error.message } : { code: 'NO_ID', message: 'The callback carried no consent request id' };
        await saveRequest(r);
        return;
      }
      r.abdmId = body.consentRequest.id;
      r.status = 'REQUESTED';
      r.error = null;
      await saveRequest(r);
    },
    async onConsentStatus(entry, body) {
      const r = await getRequest(entry.localId);
      const status = body.consentRequest && body.consentRequest.status;
      if (r && KNOWN_STATUSES.includes(status)) {
        r.status = status; // refuse to act on a value we do not recognise
        await saveRequest(r);
      }
    },
    async onConsentFetch(entry, body) {
      const r = await getRequest(entry.localId);
      const a = r && r.artefacts[entry.artefactId];
      if (!a) return;
      const consent = body.consent || {};
      const detail = consent.consentDetail || {};
      if (body.error || consent.status !== 'GRANTED' || (detail.consentId && detail.consentId !== entry.artefactId)) {
        a.status = KNOWN_STATUSES.includes(consent.status) ? consent.status : 'FAILED';
        a.error = body.error ? { code: body.error.code, message: body.error.message } : null;
        await saveRequest(r);
        return; // never request data on a revoked, expired or unclear artefact
      }
      const range = (detail.permission && detail.permission.dateRange) || {};
      a.fetched = true;
      a.hipId = detail.hip && detail.hip.id;
      a.dateRange = { from: range.from, to: range.to };
      a.eraseAt = detail.permission && detail.permission.dataEraseAt;
      await saveRequest(r);
      defer(async () => {
        try {
          await requestRecords(a, r);
        } catch (err) {
          const latest = await getRequest(r.localId);
          if (latest && latest.artefacts[a.id]) {
            latest.artefacts[a.id].error = { code: err.code || 'REQUEST_FAILED', message: err.message };
            await saveRequest(latest);
          }
          log(JSON.stringify({ level: 'error', event: 'hi_request_failed', name: err.name, code: err.code || null }));
        }
      });
    },
    async onHealthInformationOnRequest(entry, body) {
      const tx = await getTx(entry.pushToken);
      if (!tx) return;
      if (body.error) {
        tx.status = 'FAILED';
        tx.error = { code: body.error.code, message: body.error.message };
      } else if (body.hiRequest && body.hiRequest.transactionId) {
        tx.transactionId = body.hiRequest.transactionId;
      }
      await saveTx(entry.pushToken, tx);
    },

    // ---- callback: ABDM tells us the patient's decision (not an answer to a call of ours) ----
    // Returns the acknowledgement body, or null when it is not one we act on.
    async onConsentNotify(body) {
      const n = body && body.notification;
      if (!n || !KNOWN_STATUSES.includes(n.status)) return null;
      const r = await byAbdmId(n.consentRequestId);
      if (!r) return null;
      const ids = (n.consentArtefacts || []).map((a) => a && a.id).filter(Boolean);
      r.status = n.status;
      for (const id of ids) {
        const existing = r.artefacts[id] || { id, fetched: false };
        existing.status = n.status === 'REVOKED' ? 'REVOKED' : n.status === 'GRANTED' ? existing.status === 'REVOKED' ? 'REVOKED' : 'GRANTED' : n.status;
        r.artefacts[id] = existing;
        if (n.status === 'REVOKED') {
          // the patient withdrew: stop, and drop what we hold from this artefact
          await saveReceived(r.childId, (await getReceived(r.childId)).filter((rec) => rec.artefactId !== id));
        }
      }
      await saveRequest(r);
      return { acknowledgement: ids.map((id) => ({ status: 'OK', consentId: id })) };
    },

    // ---- the HIP's push to our data push URL ----
    // Returns { status } to send back. 202 once the page is taken in; the notification goes out when all pages are in.
    async receivePush(pushToken, body) {
      const tx = await getTx(pushToken);
      if (!tx || tx.expiresAt <= now().getTime() || tx.status === 'RECEIVED' || tx.status === 'FAILED') return { status: 404 };
      const request = await getRequest(tx.localId);
      const artefact = request && request.artefacts[tx.artefactId];
      if (!artefact || artefact.status !== 'GRANTED') return { status: 403 }; // revoked meanwhile
      if (tx.transactionId && body.transactionId !== tx.transactionId) return { status: 400 };
      if (!Array.isArray(body.entries) || !body.keyMaterial || !Number.isInteger(body.pageNumber) || !Number.isInteger(body.pageCount)) return { status: 400 };
      if (tx.pages.includes(body.pageNumber)) return { status: 202 }; // repeat delivery of a page
      tx.transactionId = tx.transactionId || body.transactionId;
      tx.pageCount = body.pageCount;

      const statusResponses = [];
      for (const entry of body.entries) {
        try {
          const plain = createReceiver(tx.receiver).decrypt(entry.content, body.keyMaterial);
          // The checksum is the MD5 of the content before encryption; the spec does not say hex or base64, so both are accepted.
          const md5 = createHash('md5').update(plain).digest();
          if (entry.checksum !== md5.toString('hex') && entry.checksum !== md5.toString('base64')) throw new Error('checksum mismatch');
          const bundle = JSON.parse(plain);
          if (bundle.resourceType !== 'Bundle') throw new Error('not a FHIR bundle');
          tx.records.push({
            id: randomUUID(), artefactId: tx.artefactId, transactionId: tx.transactionId, hipId: artefact.hipId || null,
            careContextReference: entry.careContextReference, receivedAt: now().toISOString(), eraseAt: artefact.eraseAt || null, bundle,
          });
          statusResponses.push({ careContextReference: entry.careContextReference, hiStatus: 'OK', description: 'Data received successfully' });
        } catch {
          // never log the content or the error text: it may echo record data
          statusResponses.push({ careContextReference: entry.careContextReference, hiStatus: 'ERRORED', description: 'The entry could not be decrypted or verified' });
        }
      }
      tx.pages.push(body.pageNumber);
      tx.lastResponses = [...(tx.lastResponses || []), ...statusResponses];
      if (tx.pages.length >= tx.pageCount) {
        const ok = tx.lastResponses.every((x) => x.hiStatus === 'OK');
        tx.status = ok ? 'RECEIVED' : 'FAILED';
        if (ok) await saveReceived(request.childId, [...(await getReceived(request.childId)), ...tx.records]);
        defer(async () => {
          try {
            await hipClient.notifyDataFlow({
              body: {
                notification: {
                  consentId: tx.artefactId,
                  transactionId: tx.transactionId,
                  doneAt: now().toISOString(),
                  notifier: { type: 'HIU', id: hiuId() },
                  statusNotification: { sessionStatus: ok ? 'RECEIVED' : 'FAILED', hipId: artefact.hipId, statusResponses: tx.lastResponses },
                },
              },
            });
          } catch (err) {
            log(JSON.stringify({ level: 'error', event: 'data_flow_notify_failed', name: err.name, code: err.code || null }));
          }
        });
      }
      await saveTx(pushToken, tx);
      return { status: 202 };
    },

    // For the tests and the status screen.
    pushStatus: async (pushToken) => {
      const tx = await getTx(pushToken);
      return tx ? tx.status : null;
    },
  };
}

module.exports = { createHiuService };
