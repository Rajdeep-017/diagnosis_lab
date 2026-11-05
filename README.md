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

The frontend is available at `http://localhost:5173`, the API at `http://localhost:8000`, and PostgreSQL on port `5432`. Compose waits for Postgres to become healthy, runs Alembic migrations, seeds the demo staff accounts and sample orders, then starts the services.

Use `docker compose down` to stop the app. Database rows persist in the `pgdata` volume; `docker compose down -v` deletes that database volume.

The demo staff accounts use `password123`:
- Front desk: `staff@example.com`
- Ops: `ops@example.com`
- Pathologist: `pathologist@example.com`

The staff sign-in link is on the home page. The login is checked against the `staff_users` PostgreSQL table; the browser receives an HttpOnly session cookie. Staff orders and queued delivery actions use the database-backed API.

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

Set `DATABASE_URL`, `JWT_SECRET`, `DEMO_MODE=true`, and `DEMO_STAFF_PASSWORD=password123` in your environment, then initialize the database and run both services:

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

Copy `.env.example` to `.env` to override Compose demo credentials. Those defaults are for local development only: set unique database credentials and a long random `JWT_SECRET`, set `DEMO_MODE=false`, and enable secure cookies behind HTTPS before deployment. `VITE_DEMO_MODE=false` hides the demo credential hint in the UI.
