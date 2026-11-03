# Documentation index

| File | Assessment task | Contents |
|---|---|---|
| [`abdm-integration.md`](abdm-integration.md) | Task B | What ABDM, HIE-CM, ABHA and FHIR are; the integration-layer design and flow diagrams; consent, errors, audit; sandbox-to-production steps; how MCP/AI tools differ from the real APIs and from the mock |
| [`aws-deployment.md`](aws-deployment.md) | Task C | Plan only (nothing deployed): Fargate vs Lambda, ALB vs API Gateway, RDS, Secrets Manager, ACM, CloudWatch, backups, least-privilege IAM, pilot cost with assumptions |
| [`security.md`](security.md) | Task D | 15 risks with mitigations, each marked implemented / partial / proposed; how one parent is kept away from another's child |
| [`../README.md`](../README.md) | Task E | Setup, example requests and responses, an invalid-request example, tests, technical challenge |
| [`screenshots/`](screenshots/) | Task E | Real screenshots of the test run, API session, validation error, FHIR bundle and revoked consent (listed in the README, "Evidence") |

Everything ABDM-related in this repo is a **local mock with synthetic data**. None of it is a live ABDM integration.
