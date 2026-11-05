# Deployment notes

## Local run

1. Copy `.env.example` to `.env` and set the required values.
2. Run `docker compose up --build` from the repository root. The backend applies Alembic migrations and seeds demo data before starting.

## Production

- Backend: deploy the FastAPI service to Render or Fly.io with a managed Postgres instance.
- Frontend: deploy to Vercel, pointing to the backend origin.
- Use managed Postgres and enable automatic backups.

## Demo logins

- Patient: `+91 9876543210`
- Front-desk: `staff@example.com` / `password123`
- Operations: `ops@example.com` / `password123`
- Pathologist: `pathologist@example.com` / `password123`

## Environment variable names

- DATABASE_URL
- JWT_SECRET
- GEMINI_API_KEY
- GEMINI_MODEL
- FRONTEND_ORIGIN
- LINK_TTL_HOURS
- OTP_TTL_MINUTES
- OTP_MAX_ATTEMPTS
- ENCRYPTION_KEY
- DEMO_MODE
