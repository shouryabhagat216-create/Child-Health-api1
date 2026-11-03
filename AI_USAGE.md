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

## Verification done so far (by running, not by reading)

- Batch 1 and 2: 59 Jest tests pass against the in-memory repository.
- Migrations 002 and 003 were applied to a local PostgreSQL 16 database and the endpoints were exercised with curl against it.
- Not yet verified: the official ABDM docs were read for the milestone descriptions and API paths, but nothing here has been validated against the real ABDM sandbox. The ABDM code is a mock.
