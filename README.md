# Child Health API

WombTo18 second-round technical assessment (AWS Cloud Migration & ABDM Integration Intern), by Shourya Bhagat.

A small REST API for registering children and creating vaccination reminders, with a **mock** ABDM
prototype (ABHA verification, care-context linking, consent, FHIR output, audit) and a React
dashboard. **All data is synthetic. Nothing here talks to the real ABDM, and nothing is deployed to AWS.**

> AI assistance is disclosed in [`AI_USAGE.md`](AI_USAGE.md). Files are marked reviewed only after the author has read and run them.

## What is in the repo

| Path | What |
|---|---|
| `backend/` | Node.js + Express API, PostgreSQL, tests (Task A, plus the ABDM mock) |
| `frontend/` | React + Vite dashboard, always labelled MOCK |
| `docs/abdm-integration.md` | Task B: ABDM integration design |
| `docs/aws-deployment.md` | Task C: AWS deployment plan (not deployed) |
| `docs/security.md` | Task D: security risks and mitigations |

## Stack
Node.js 18+ (developed on a newer version), Express 4, PostgreSQL 16 (in-memory mode for quick runs
and tests), Zod validation, JWT (`jsonwebtoken`), `express-rate-limit`, Jest + Supertest, React + Vite.

## Setup (macOS)

### 1. Database (pick one)
**Option A, in-memory (no database, data lost on restart; easiest):** nothing to install. Use `DB_MODE=memory` below.

**Option B, PostgreSQL with Homebrew:**
```bash
brew install postgresql@16
brew services start postgresql@16
```
Create the database only if it does not exist yet:
```bash
psql -d postgres -c "CREATE ROLE childhealth LOGIN PASSWORD 'childhealth'"
createdb -O childhealth childhealth
```
These are local development credentials, not secrets.

**Option C, Docker:** `docker compose up -d db` (needs Docker Desktop, which was not installed on the author's machine).

### 2. Backend
```bash
cd backend
cp .env.example .env        # then edit values; .env is git-ignored, never commit it
npm install
npm run migrate             # applies migrations 001 to 004 (skip in memory mode)
npm run dev                 # http://localhost:3000   (or: DB_MODE=memory npm run dev)
```

### 3. Frontend (second terminal tab)
```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```
The backend allows browser calls only from `http://localhost:5173` (`CORS_ORIGIN`).

### 4. Tests
```bash
cd backend
npm test
```
The tests use the in-memory repository, so no database is needed. Current result: **197 tests in 14 suites, all passing** (the ABDM sandbox code is tested against fake ABDM replies; see `INTEGRATION-PLAN.md` for what has and has not run against the real sandbox).

## API

All routes except `/health` and `/auth/mock-login` need `Authorization: Bearer <token>`.
`/auth/mock-login` exists only outside production and uses synthetic guardians.

| Method | Endpoint | Description | Success | Errors |
|---|---|---|---|---|
| GET | `/health` | API and database health (public) | 200 | 503 if the database is down |
| POST | `/auth/mock-login` | Mock login for synthetic guardians | 200 | 400, 401, 429 |
| POST | `/children` | Register a child (owned by the logged-in guardian) | 201 | 400, 401, 409 |
| GET | `/children` | List the logged-in guardian's children | 200 | 401 |
| GET | `/children/:id` | Get a child's profile | 200 | 400, 401, 404 |
| POST | `/reminders` | Create a vaccination reminder | 201 | 400, 401, 403, 404 |
| | `/abdm/...` | **MOCK** ABDM prototype, see [`docs/abdm-integration.md`](docs/abdm-integration.md) | | |

Errors always use one shape:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [], "requestId": "..." } }
```

### Example session (synthetic data)
```bash
# 1. Log in as a synthetic guardian and keep the token
TOKEN=$(curl -s -X POST http://localhost:3000/auth/mock-login \
  -H "Content-Type: application/json" \
  -d '{"username":"neha.sharma","password":"mock-password-1"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# 2. Register a child
curl -X POST http://localhost:3000/children \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Aarav Sharma","dateOfBirth":"2024-03-15","guardianName":"Neha Sharma","state":"Maharashtra","consentStatus":"granted"}'
```
Response `201 Created` (example values):
```json
{
  "id": "3f6c1c0e-8a43-4b0e-9d52-5b1d6a7a9c11",
  "name": "Aarav Sharma",
  "dateOfBirth": "2024-03-15",
  "guardianName": "Neha Sharma",
  "state": "Maharashtra",
  "consentStatus": "granted",
  "createdAt": "2026-11-03T10:15:42.123Z"
}
```
```bash
# 3. Get the child (use the id from step 2)
curl http://localhost:3000/children/<id> -H "Authorization: Bearer $TOKEN"

# 4. Create a vaccination reminder
curl -X POST http://localhost:3000/reminders \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"childId":"<id>","vaccineName":"MMR-1","dueDate":"2025-03-15"}'
```
The reminder comes back as `201` with `reminderStatus` defaulting to `"scheduled"`.

### Invalid request example
```bash
curl -i -X POST http://localhost:3000/children \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Aarav Sharma","dateOfBirth":"15-03-2024"}'
```
Response `400 Bad Request`:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "dateOfBirth", "message": "must be in YYYY-MM-DD format" },
      { "field": "guardianName", "message": "is required" },
      { "field": "state", "message": "must be a valid Indian state or union territory" },
      { "field": "consentStatus", "message": "must be one of: pending, granted, revoked" }
    ],
    "requestId": "..."
  }
}
```

### Other behaviours worth knowing
- **Missing child:** `404 CHILD_NOT_FOUND`. A child owned by another guardian gives the *same* 404.
- **Duplicate child id:** `409 DUPLICATE_RESOURCE`. Ids are generated by the server; sending your own `id` is a `400`.
- **Revoked consent:** creating a reminder returns `403 CONSENT_REVOKED`. `pending` is deliberately still allowed for reminders (sharing records outside is stricter and needs `granted`).
- **Too many requests:** `429 RATE_LIMITED`.

## Design notes
- **Layers:** routes (HTTP) → services (business rules) → repositories (storage). The repository has Postgres and in-memory versions behind the same methods, so tests need no database.
- **Validation:** strict Zod schemas; real calendar dates; date of birth not in the future; state must be an Indian state or union territory; unknown fields rejected.
- **Ownership:** each child belongs to the guardian who registered it (`children.guardian_id`, migration 002).
- **Privacy:** the access log never records request bodies; audit events hold ids only; all SQL is parameterized.
- **ABDM mock:** separate from the guardian's own consent. See `docs/abdm-integration.md` for the flow, scenarios and limits.

## Technical challenge: adding authentication without breaking the original tests
The first version had 17 passing tests and no login. Adding "a parent can only see their own child"
meant every endpoint now required a token, which would make all 17 tests fail, because they called the
API anonymously. Rewriting 17 working tests risked hiding real regressions.

What I did: kept every test scenario unchanged and changed only how requests are sent. A small helper
(`backend/tests/helpers/auth.js`) wraps supertest so each request carries a valid token for a synthetic
guardian, and it passes a fixed test config so the tests never depend on a developer's `.env`. Then I
added separate tests for the new rules (401 without a token, 404 for another guardian's child, rate
limits, CORS). One related detail: returning **403** for someone else's child would confirm the child
exists, so it returns the same **404** as a missing child.

A second real problem came later. A test for the audit trail failed because successful
health-information fetches were stored without a child id, so they did not appear in the child's audit
list. The cause was that the route only knew the consent id; the fix was to look up the child from the consent.

## Limits and honesty
- The ABDM part is a **mock**. It is not connected to any ABDM system, and the FHIR bundle is not validated against ABDM profiles.
- Authentication is a mock too; real accounts, MFA and token revocation would be needed.
- Nothing was deployed to AWS and no AWS cost was incurred; see `docs/aws-deployment.md`.
- No automated tests exist for the frontend.

## Evidence
Real screenshots from the author's own runs on 3 Nov 2026 (synthetic data, local machine). Files are in [`docs/screenshots/`](docs/screenshots/).

| Screenshot | What it shows |
|---|---|
| [`test_passing.png`](docs/screenshots/test_passing.png) | `npm test` on 3 Nov 2026: 4 suites, 72 tests, all passing (an older run; the suite is now larger) |
| [`api_requests.png`](docs/screenshots/api_requests.png) | Terminal session: mock login, register a child (201), get the child, create a reminder (default status `scheduled`), and the start of an invalid request returning `400 Bad Request` |
| [`invalid_request.png`](docs/screenshots/invalid_request.png) | The `400 VALIDATION_ERROR` body listing the bad or missing fields |
| [`fhir_bundle.png`](docs/screenshots/fhir_bundle.png) | Dashboard (MOCK mode): all four ABDM steps ticked and the synthetic FHIR document Bundle returned for a granted consent |
| [`consent_revoked.png`](docs/screenshots/consent_revoked.png) | After the guardian revokes consent, fetching health information is refused with `CONSENT_NOT_GRANTED` |
| [`dashboard.png`](docs/screenshots/dashboard.png) | Dashboard overview: the Children tab with the registration form |

Not captured: a screenshot of the "other parent gets 404" case. That behaviour is covered by automated tests in `backend/tests/authorization.test.js` and `backend/tests/abdm.test.js`.
