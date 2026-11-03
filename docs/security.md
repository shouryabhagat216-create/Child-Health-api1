# Security and privacy (Task D)

This API handles children's health information, so it is treated as sensitive even though every
record in this repo is synthetic. Each risk below says what **actually exists in the code** and what
is only **proposed**. Status words:

- **Implemented**: in the code and covered by a test or a manual check.
- **Partial**: some of it exists; the gap is stated.
- **Proposed**: not built; described so a reviewer can see the plan.

Nothing here has had an independent security review or a penetration test.

## Risk register

| # | Risk | Impact | Mitigation | Status |
|---|---|---|---|---|
| 1 | **One parent reads or changes another parent's child** (broken object-level access) | Disclosure of a child's record | Every child, reminder and ABDM operation checks that the child's owner is the logged-in guardian (`services/ownership.js`). The owner comes from the verified token, never from the request body (`guardianId` in a body is rejected). Someone else's child returns the same **404** as a nonexistent child, so ids cannot be probed. Child ids are random UUIDs. | **Implemented** (tests in `authorization.test.js`, `abdm.test.js`) |
| 2 | **Weak or missing authentication** | Anyone can call the API | All routes except `/health` and the mock login require a signed JWT (HS256, algorithm pinned, 1 hour expiry); forged, expired and garbage tokens are rejected with one generic 401. **The login is a mock** with fake users, switched off when `NODE_ENV=production`. | **Partial**: real identity provider (for example Amazon Cognito with MFA/OTP) is **Proposed** |
| 3 | **Brute-force and OTP guessing** | Account takeover | Login limited to 10 attempts per 15 minutes per IP; other routes 300 per 15 minutes; the mock link OTP allows only 3 wrong tries. | **Partial**: limits are in memory per process (see `aws-deployment.md` section 7). Shared store or AWS WAF rules are **Proposed**; no account lockout or CAPTCHA |
| 4 | **Consent bypass or misuse** | Sharing data without permission | Two separate consents (guardian consent to processing, and per-request ABDM consent). Records are shared only if **both** allow it. The live consent status is re-read on every fetch, so **revocation applies immediately**. Only the owning guardian can approve, deny or revoke. Consent requests are capped at 90 days. Reminders are blocked when guardian consent is `revoked`. | **Implemented** (mock). Caveat: the `consentStatus` a client sends when registering a child is **not verified** by the system; a real service must collect and evidence consent (who, when, what text was shown) |
| 5 | **Collecting or sharing more data than needed** (data minimisation) | Privacy harm, legal exposure | The FHIR bundle contains only *completed* vaccinations inside the consented date range; no guardian name; only a masked ABHA. Responses never expose the internal `guardianId`. Only the fields the assessment needs are stored. Unknown request fields are rejected. | **Implemented** for sharing. Retention limits, deletion and erasure on request are **Proposed** |
| 6 | **Health data exposed in transit or at rest** | Disclosure | Plan: HTTPS only (ACM certificate on the load balancer, HTTP redirects to HTTPS), TLS-required database connection, RDS storage encryption with KMS, private subnets. The mock ABDM data transfer is **not encrypted** (the real one is). `helmet` sets standard security headers. | **Proposed** for TLS and encryption (nothing deployed); `helmet` **Implemented** |
| 7 | **Credentials and secrets leaked** | Full compromise | `.env` and `.env.*` are git-ignored (only `.env.example` is committed). The app refuses to start in production without `JWT_SECRET`. Only a throwaway dev secret exists for local use. Plan: AWS Secrets Manager and least-privilege IAM. **Known weakness:** the two mock-guardian passwords are fake and written in source on purpose. | **Partial**: Secrets Manager and key rotation are **Proposed** |
| 8 | **Sensitive data in logs** | Disclosure through log access | The access log records method, path (query string removed), status and duration only; **never bodies, tokens or headers**. Error logs contain the request id, error name and message, not request data. Audit events hold ids and reason codes only (a test checks they contain no ABHA number, OTP, token, name or health data). Audit events are separate from access logs. | **Implemented**. Paths contain child ids (random UUIDs); treat logs as confidential anyway |
| 9 | **Injection (SQL and input abuse)** | Data theft or corruption | All SQL is parameterized. Request bodies are validated with strict schemas (types, lengths, dates, enums, UUIDs). JSON body limit 100 KB. | **Implemented** |
| 10 | **Browser-side attacks (cross-origin calls, token theft)** | Session theft | CORS allows only the configured frontend origin. The dashboard keeps the token **in memory only** (not localStorage) and never prints it. React escapes rendered values. | **Implemented** for these. A Content Security Policy tuned for the frontend and cookie-based sessions are **Proposed** |
| 11 | **Denial of service and abuse** | Outage | Rate limiting and body-size limit (see 3). | **Partial**: AWS WAF, autoscaling and per-user quotas **Proposed** |
| 12 | **Missing accountability** (nobody can tell who did what) | Cannot investigate or prove compliance | Every ABDM action is audited with request id, actor, child, consent, outcome and timestamp, including denied and failed attempts. | **Implemented**. Gaps: validation failures are not audited; rows are **not tamper-proof** (the app could change them). Append-only storage or shipping events to write-once storage is **Proposed**. Plain child/reminder actions (register, create) are not audited yet |
| 13 | **Vulnerable dependencies** | Known exploits | A lockfile is committed. | **Proposed**: `npm audit` in CI, automated dependency updates, image scanning in ECR |
| 14 | **Mock features reaching production** | Fake auth or fake ABDM treated as real | Mock login is removed when `NODE_ENV=production` (test included). Every ABDM response is labelled MOCK. | **Partial**: the ABDM mock routes themselves are still mounted; remove or flag them off in a production build (**Proposed**) |
| 15 | **Backups lost or untested** | Data loss | Plan: RDS automated backups, point-in-time recovery, snapshot before migrations, restore drill. | **Proposed** |

## How a parent is prevented from reading another parent's child
1. The login returns a token whose subject is the guardian's id. The server verifies it on each request.
2. Route handlers pass `req.guardian.id` (from the token) to the service layer.
3. The service layer loads the child with `findOwnedChild(repo, childId, guardianId)`. If the child
   is missing **or** owned by someone else, it throws the same `CHILD_NOT_FOUND` error.
4. ABDM consents are checked through their child, so a consent id from another family returns 404
   `CONSENT_NOT_FOUND`.
5. The list endpoint filters by guardian in the database query, so other families' children never
   enter the response.

Tested scenarios: reading, creating a reminder, listing, requesting and deciding consents, and
fetching records as the wrong guardian; each returns 404 and changes nothing.

## Known limitations (read before relying on any of this)
- Authentication is a mock; there are no real accounts, password hashing, MFA, token revocation or refresh.
- Legacy rows created before migration 002 have no owner and are invisible through the API.
- Consent evidence is not captured, and `consentStatus` is taken on trust.
- The mock ABDM transfer is unencrypted and the FHIR output is not validated against ABDM profiles.
- A real ABDM go-live also requires an independent security audit (a Web Application Security
  Assessment by an approved agency and a *Safe to Host* certificate), per the official go-live page.
- No threat model workshop, penetration test, or compliance review (for example DPDP Act) has been done.
