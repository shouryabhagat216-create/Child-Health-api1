const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const { createMemoryStore } = require('../state/stateStore');

// Inbound callbacks from ABDM (the bridge). Mounted at the root: the registered bridge URL is the base and each
// path is relative to it. Every route passes the callback guard first. A callback is acted on only when its
// response.requestId is one we sent and have not handled; anything else is logged and dropped, never stored.
const answer = z.object({ response: z.object({ requestId: z.string().min(1) }).passthrough() }).passthrough();

// Callbacks that ABDM starts (nothing of ours is being answered) carry a REQUEST-ID of their own. A request id seen
// before is a repeat delivery and is dropped, so we answer each one once.
// Kept in the shared store so a repeat delivery to another container is dropped too. The first writer wins
// (one atomic insert).
function createSeen({ store = createMemoryStore(), ttlMs = 60 * 60 * 1000 } = {}) {
  return async (id) => {
    if (!id) return true;
    return !(await store.putNew('callback-seen', id, { seen: true }, { ttlMs }));
  };
}

function bridgeRouter({ guard, pending, hipLinking, hipData, hiu, hipClient, defer, store, log = (line) => console.warn(line) }) {
  const router = express.Router();
  const seen = createSeen({ store });

  // Answers ABDM's own requests: acknowledge at once with 202, then do the work and reply by call. Failures in the
  // deferred work are logged by name only.
  const asked = (handle) =>
    asyncHandler(async (req, res) => {
      const requestId = req.get('REQUEST-ID');
      if (await seen(requestId)) {
        log(JSON.stringify({ level: 'warn', event: 'callback_dropped', reason: 'repeat or missing request id', path: req.path, requestId: requestId || null }));
        return res.status(202).end();
      }
      res.status(202).end();
      return defer(async () => {
        try {
          await handle({ body: req.body || {}, requestId, facilityId: req.facilityId });
        } catch (err) {
          log(JSON.stringify({ level: 'error', event: 'callback_handler_failed', path: req.path, name: err.name, code: err.code || null, requestId }));
        }
      });
    });


  const answers = (kind, handle) =>
    asyncHandler(async (req, res) => {
      const parsed = answer.safeParse(req.body);
      const entry = parsed.success ? await pending.take(parsed.data.response.requestId) : null;
      if (!entry || entry.kind !== kind) {
        log(JSON.stringify({ level: 'warn', event: 'callback_dropped', reason: 'not an answer to a call we sent', path: req.path, requestId: req.get('REQUEST-ID') || null }));
        return res.status(202).end();
      }
      await handle(entry, req.body);
      return res.status(202).end();
    });

  router.post('/api/v3/hip/token/on-generate-token', guard, answers('link-token', (entry, body) => hipLinking.onLinkToken(entry, body)));
  router.post('/api/v3/link/on_carecontext', guard, answers('link', (entry, body) => hipLinking.onCareContextLinked(entry, body)));

  // ---- user-initiated linking ----
  router.post('/api/v3/hip/patient/care-context/discover', guard, asked(async ({ body, requestId, facilityId }) => {
    const found = await hipLinking.discover(body);
    await hipClient.onDiscover({
      hiuId: facilityId,
      body: found
        ? { transactionId: body.transactionId, patient: found.patient, matchedBy: found.matchedBy, response: { requestId } }
        : { transactionId: body.transactionId, error: { code: 'ABDM-9999', message: 'No matching record found' }, response: { requestId } },
    });
  }));
  router.post('/api/v3/hip/link/care-context/init', guard, asked(async ({ body, requestId }) => {
    const out = await hipLinking.initLink(body);
    await hipClient.onLinkInit({
      body: out.error
        ? { transactionId: body.transactionId, error: out.error, response: { requestId } }
        : {
            transactionId: body.transactionId,
            link: { referenceNumber: out.linkRefNumber, authenticationType: 'DIRECT', meta: { communicationMedium: 'MOBILE', communicationHint: 'OTP', communicationExpiry: out.expiresAt } },
            response: { requestId },
          },
    });
  }));
  router.post('/api/v3/hip/link/care-context/confirm', guard, asked(async ({ body, requestId }) => {
    const c = body.confirmation || {};
    const out = await hipLinking.confirmLink({ linkRefNumber: String(c.linkRefNumber || ''), token: String(c.token ?? '') });
    await hipClient.onLinkConfirm({ body: out.error ? { error: out.error, response: { requestId } } : { patient: out.patient, response: { requestId } } });
  }));

  // ---- consent and data flow ----
  router.post('/api/v3/consent/request/hip/notify', guard, asked(async ({ body, requestId, facilityId }) => {
    const ack = await hipData.onConsentNotify(facilityId, body);
    if (!ack) {
      log(JSON.stringify({ level: 'warn', event: 'callback_dropped', reason: 'consent notification not acted on', path: '/api/v3/consent/request/hip/notify', requestId }));
      return;
    }
    await hipClient.onConsentNotify({ hipId: facilityId, body: { ...ack, response: { requestId } } });
  }));
  router.post('/api/v3/hip/health-information/request', guard, asked(async ({ body, requestId, facilityId }) => {
    const out = await hipData.onHealthInformationRequest(facilityId, body, requestId);
    await hipClient.onHealthInformationRequest({
      hipId: facilityId,
      body: out.ok
        ? { hiRequest: { transactionId: body.transactionId, sessionStatus: 'ACKNOWLEDGED' }, response: { requestId } }
        : { error: out.error, response: { requestId } },
    });
    if (out.ok) await out.push(); // only after the acknowledgement has gone
  }));

  // ---- M3 as a HIU: answers to our calls ----
  router.post('/api/v3/hiu/consent/request/on-init', guard, answers('consent-init', (entry, body) => hiu.onConsentInit(entry, body)));
  router.post('/api/v3/hiu/consent/request/on-status', guard, answers('consent-status', (entry, body) => hiu.onConsentStatus(entry, body)));
  router.post('/api/v3/hiu/consent/on-fetch', guard, answers('consent-fetch', (entry, body) => hiu.onConsentFetch(entry, body)));
  router.post('/api/v3/hiu/health-information/on-request', guard, answers('hi-request', (entry, body) => hiu.onHealthInformationOnRequest(entry, body)));

  // ---- M3: the patient's decision (ABDM starts this one) ----
  router.post('/api/v3/hiu/consent/request/notify', guard, asked(async ({ body, requestId, facilityId }) => {
    const ack = await hiu.onConsentNotify(body);
    if (!ack) {
      log(JSON.stringify({ level: 'warn', event: 'callback_dropped', reason: 'consent notification not acted on', path: '/api/v3/hiu/consent/request/notify', requestId }));
      return;
    }
    await hipClient.onHiuConsentNotify({ hiuId: facilityId, body: { ...ack, response: { requestId } } });
  }));

  // ---- M3: the HIP pushes the encrypted records here. The address is a one-time capability URL we built for one
  // transfer; the HIP also sends the gateway bearer token. Records are large, so this route has its own body limit
  // (the app skips its general 100kb parser for this path).
  router.post('/api/v3/hiu/data-push/:token', express.json({ limit: '10mb' }), asyncHandler(async (req, res) => {
    if (!/^Bearer\s+\S+/.test(req.get('Authorization') || '')) {
      log(JSON.stringify({ level: 'warn', event: 'callback_rejected', reason: 'missing bearer token', path: '/api/v3/hiu/data-push/:token' }));
      return res.status(401).json({ error: { code: 'CALLBACK_REJECTED', message: 'Callback rejected' } });
    }
    const out = await hiu.receivePush(req.params.token, req.body || {});
    if (out.status !== 202) log(JSON.stringify({ level: 'warn', event: 'data_push_refused', status: out.status }));
    return res.status(out.status).end();
  }));

  return router;
}

module.exports = { bridgeRouter, createSeen };
