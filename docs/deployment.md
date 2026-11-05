# Deployment notes

## Local run

1. Copy `.env.example` to `.env` and set the required values.
2. Run `docker compose up --build` from the repository root. The backend applies Alembic migrations and seeds demo data before starting.

## Production

- Backend: deploy the FastAPI service to Render or Fly.io with a managed Postgres instance.
- Frontend: deploy to Vercel, pointing to the backend origin.
- Use managed Postgres and enable automatic backups.

## Demo accounts

Local demo accounts and sample orders are created only when `DEMO_MODE=true`.
Set a private `DEMO_STAFF_PASSWORD` in your local environment before starting
Compose. Do not reuse demo credentials in production; production rejects demo
mode and requires secure cookies and a unique JWT secret.

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
