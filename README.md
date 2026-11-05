# Diagnostic Lab Report Delivery Portal

This repository contains a diagnostic lab report delivery portal for Company A, Vijayawada. The project is structured as a modular monolith with a FastAPI backend and a Vite/React frontend, intended for a solo-delivery 7-day implementation.

## Included
- Backend scaffold with health route, models, rules engine, and tests
- Frontend design system and patient flow placeholder screens
- Seed sample data and assumptions documentation
- Docker Compose and CI workflow for local and remote deployment

## Local development

### Docker Compose (recommended)

```bash
docker compose up --build
```

The frontend is available at `http://localhost:5173`, the API at `http://localhost:8000`, and PostgreSQL on port `5432`. Compose waits for Postgres to become healthy, runs Alembic migrations, seeds demo accounts and sample orders only when `DEMO_MODE=true`, then starts the services.

Use `docker compose down` to stop the app. Database rows persist in the `pgdata` volume; `docker compose down -v` deletes that database volume.

Demo staff accounts are created only when `DEMO_MODE=true` and a demo password is configured; credentials are provided by the local environment, not this guide. The staff sign-in link is in the patient home-page footer. Staff login is checked against the `staff_users` PostgreSQL table; the browser receives an HttpOnly session cookie.

Patient OTP verification, family selection, report retrieval, CSV imports, delivery links, and the staff review/audit views are connected to the database-backed API.

### Tests

Run the real-service browser journeys from `frontend`:

```bash
npm run test:real-backend
```

This command requires Docker and Playwright's Chromium browser. It creates a separate, freshly migrated and seeded PostgreSQL stack, runs the three no-mock Playwright journeys against it, then removes only that temporary stack. It does not reset the normal Compose development database.

### Local development without Docker

Install backend and frontend dependencies once, and start a local PostgreSQL database:

```powershell
python -m pip install -r backend/requirements.txt
cd frontend
npm install
cd ..
```

Set `DATABASE_URL`, a development-only `JWT_SECRET`, `DEMO_MODE=true`, and a private `DEMO_STAFF_PASSWORD` in your local environment, then initialize the database and run both services:

```powershell
cd backend
alembic upgrade head
python -m app.bootstrap
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

In a second terminal:

```powershell
cd frontend
npm run dev -- --host 0.0.0.0
```

The Vite `/api` proxy points to `http://127.0.0.1:8000` by default. Change it with `VITE_API_PROXY_TARGET` when needed.

Copy `.env.example` to `.env` for local development only. Production must use `docker-compose.production.yml`, unique secrets, `DEMO_MODE=false`, and secure cookies behind HTTPS; configure its required settings through the deployment environment, not the demo defaults. Demo accounts and data are never seeded when demo mode is off.

### Production deployment

Production uses a separate static frontend/API Compose stack. Configure
`DATABASE_URL`, `FRONTEND_ORIGIN` (the HTTPS site origin), and a randomly
generated `JWT_SECRET` of at least 32 characters in the deployment environment.
The production settings reject demo mode and insecure auth cookies. The backend
image does not migrate the database at startup: run the release migration step
before updating the API:

```sh
sh scripts/migrate-production.sh
docker compose -f docker-compose.production.yml up -d --build
```

If a release must be rolled back, restore a database backup as appropriate and
run `sh scripts/rollback-migration.sh` to downgrade one Alembic revision. Review
[`docs/SECURITY.md`](docs/SECURITY.md) for implemented controls and outstanding
privacy/compliance deployment work.
