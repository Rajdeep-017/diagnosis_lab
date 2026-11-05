# Security and privacy controls

This document describes the controls present in this repository and the work
that still needs to be completed before handling production patient data. It is
not a claim of DPDP Act compliance or legal advice. The data fiduciary should
have Indian privacy counsel review the applicable obligations and current rules.

## Implemented in this repository

- Production settings are read from process environment only; `.env` files are
  not loaded by the application. Startup fails when production uses a short
  `JWT_SECRET`, enables demo mode, or disables secure authentication cookies.
- Cookie-authenticated state-changing requests reject cross-site Fetch Metadata
  and mismatched `Origin`/`Referer` values, and browser-originated mutations
  require the `X-CSRF-Token` request header. Same-origin browser requests work;
  requests without browser-origin metadata remain available for API clients and
  the existing automated API tests.
- CORS allows only the configured frontend origin, credentials, the required
  API methods, and a small set of request headers.
- API responses include a restrictive CSP (`frame-ancestors 'none'`), HSTS,
  `X-Content-Type-Options`, and `Referrer-Policy`. The static frontend applies
  the same headers.
- Request logs are structured JSON and contain a request ID, method, status,
  and duration only. Request bodies, cookies, authorization headers, and query
  strings are not logged. The backend container disables Uvicorn access logs.
- Database readiness checks execute `SELECT 1`; database connections have
  bounded pool settings and a PostgreSQL statement timeout. Container startup
  does not run schema migrations.
- Backend and frontend production images use separate build/runtime stages and
  non-root users. The production Compose file disables demo mode, requires
  production secrets, and applies a read-only filesystem and dropped Linux
  capabilities.
- `scripts/migrate-production.sh` runs migrations as an explicit release step;
  `scripts/rollback-migration.sh` downgrades one Alembic revision.
- CI runs backend lint/type checks and tests, frontend unit/browser and
  real-backend journeys, secret scanning, `pip-audit`, and high-severity npm
  audit checks.

## DPDP-related work still required

- Publish and maintain a clear privacy notice, capture and prove valid consent
  where required, and document the purposes and lawful basis for each data flow.
- Implement and operationalize data-principal request handling (access,
  correction, erasure, grievance handling, and any other applicable rights),
  including identity verification and response timelines.
- Assign accountable privacy/security owners and any required grievance
  contact; establish incident assessment, regulator/data-principal notification,
  and breach-response procedures.
- Define purpose-based retention and deletion schedules for reports, OTPs,
  audit records, backups, logs, and notification-provider copies, and test that
  deletion works across those systems.
- Choose, document, and verify India-based hosting and data-residency controls
  for the application, database, backups, logs, and notification processors.
- Implement consent withdrawal as a verified, auditable workflow; the current
  notice gives patients a lab contact path but the app does not yet process a
  withdrawal request or revoke linked access.
- Complete a data inventory and risk assessment, document processors and
  contractual safeguards, assess cross-border transfers, and retain evidence of
  security reviews and staff training.
- Select and operate production-grade database/storage encryption, backups,
  key management and rotation, access monitoring, and restore testing. These
  controls depend on the deployment and managed-service configuration and are
  not supplied by this repository alone.

Before go-live, complete the deferred items that apply, validate the deployed
TLS/reverse-proxy and database configuration, rotate all credentials, and
review the threat model and incident runbooks.
