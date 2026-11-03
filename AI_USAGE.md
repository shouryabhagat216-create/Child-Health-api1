# AI usage disclosure

The assessment asks that AI-generated code is clearly identified. This file is that record.

**Tool used:** Claude (Anthropic) was used as a coding assistant for scaffolding, code and documentation drafts.

**Author:** Shourya Bhagat. The author is responsible for the submission and must be able to explain every file.

## Files drafted with AI assistance

| Area | Files | Review status |
|---|---|---|
| Project setup | `docker-compose.yml`, `backend/package.json`, `backend/Dockerfile`, `.gitignore`, `backend/.env.example` | Pending review |
| API core | `backend/src/app.js`, `server.js`, `config/`, `errors.js`, `middleware/` | Pending review |
| Validation | `backend/src/validation/schemas.js` | Pending review |
| Routes and services | `backend/src/routes/`, `backend/src/services/` | Pending review |
| Data layer | `backend/src/repositories/`, `backend/src/db/` | Pending review |
| Tests | `backend/tests/api.test.js` (only the auth import and test config changed) | Pending review |
| Auth and ownership (Batch 1) | `backend/src/auth/`, `middleware/authenticate.js`, `middleware/rateLimit.js`, `routes/auth.js`, `services/ownership.js`, `db/migrations/002_guardian_ownership.sql`, `tests/authorization.test.js`, `tests/helpers/auth.js` | Pending review |
| ABDM mock (Batch 2) | `backend/src/abdm/`, `middleware/mockScenario.js`, `routes/abdm.js`, `services/abdmService.js`, `db/migrations/003_abdm_mock.sql`, `tests/abdm.test.js` | Pending review |

Update the "Review status" column (and add new rows) as you read, run and change each file.
Anything you later write or rewrite yourself should be noted as such.
| FHIR, fetch and audit (Batch 3) | `backend/src/fhir/mapper.js`, `services/auditService.js`, `db/migrations/004_audit_events.sql`, fetch code in `services/abdmService.js`, `routes/abdm.js`, `tests/fhir-and-audit.test.js` | Pending review |
| Dashboard (Batch 4) | `frontend/` (Vite config, `src/api.js`, `src/App.jsx`, `src/components/`, `src/styles.css`, `src/states.js`) | Pending review |
| Documentation (Batch 5) | `README.md`, `docs/README.md`, `docs/abdm-integration.md`, `docs/aws-deployment.md`, `docs/security.md` | Pending review. AWS cost figures are rough estimates from general knowledge, not live pricing |
| ABDM sandbox: M1 (Batch 6) | `backend/src/abdm/abha/`, `services/abhaService.js`, `routes/abha.js`, `abdm/sandboxClient.js` changes, `scripts/abha-create-run.sh`, `scripts/abha-login-run.sh`, `tests/abhaProvider.test.js`, `abhaCreate.test.js`, `abhaLogin.test.js`, `redaction.test.js` | Pending review. Create ABHA by Aadhaar OTP was run against the real ABDM sandbox by the author with their own test identity; login by ABHA number has NOT been run for real |
| ABDM sandbox: M2 and M3 (Batch 7) | `backend/src/abdm/fidelius.js`, `abdm/hip/`, `abdm/bridge/`, `abdm/facilities.js`, `abdm/safePushUrl.js`, `middleware/callbackGuard.js`, `services/hipLinkingService.js`, `hipDataService.js`, `hiuService.js`, `routes/bridge.js`, `routes/hip.js`, `routes/hiu.js`, `scripts/bridge-url-v3.js`, `scripts/link-test-facility.js`, `tests/fidelius.test.js`, `hipLinking.test.js`, `hipFlows.test.js`, `hiuFlows.test.js` | Pending review. Tested ONLY against fake ABDM replies; nothing here has run against the real sandbox because no registered facility id exists. Encryption interop with a real ABDM peer is unproven |
| ABDM sandbox: screens (Batch 8) | `frontend/src/components/sandbox/`, `frontend/src/consentText.js`, `frontend/src/api.js` and `App.jsx` changes, `INTEGRATION-PLAN.md` | Pending review. The consent text was compared with ABDM's source word for word by script. Checked in a browser without any identity; no real Aadhaar was entered by the assistant |

## Verification done so far (by running, not by reading)

- Batches 1 to 3: 72 Jest tests pass against the in-memory repository.
- Migrations 002, 003 and 004 were applied to a local PostgreSQL 16 database and the endpoints were exercised with curl against it.
- Not yet verified: the official ABDM docs were read for the milestone descriptions and API paths, but nothing here has been validated against the real ABDM sandbox. The ABDM code is a mock.
- The FHIR bundle is core FHIR R4 structure only. The ABDM FHIR profile page could not be fetched, so nothing is validated against the ABDM implementation guide and no ABDM-profile compliance is claimed.
- Batch 4: the React dashboard builds (`npm run build`) and was driven by hand in a browser against the API in memory mode: login, register child, add reminder, verify ABHA, link care context, request and approve consent, fetch the FHIR bundle, then revoke and see the fetch refused. The browser console showed only the expected 403.
- No automated frontend tests exist yet.

- Batches 6 to 8 (sandbox work): 197 Jest tests pass in 14 suites, against fake ABDM replies. Real sandbox evidence so far: gateway session, ABHA certificate fetch, encrypted Aadhaar OTP request, ABHA creation, address suggestions and creation, profile and card, and the V3 bridge callback URL update. Not yet real: login by ABHA number, all of M2 and M3.
