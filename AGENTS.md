# timesheet-app

Multi-tenant time-tracking app: Express + SQLite backend, React 19 + MUI frontend.

- Backend: validate all request bodies with the Joi schemas in `backend/src/validation/schemas.js`; return `400` with `{ error: ... }` on validation failure.
- Every DB query must be parameterized (`?` placeholders) and scoped by `user_email` (user isolation).
- Frontend: React 19 + TypeScript + Material UI; server state goes through TanStack Query hooks only.
- Commands: test `cd backend && npm test` · lint `cd frontend && npm run lint` · build `cd frontend && npm run build`.
- Dev servers: backend `cd backend && npm run dev` (port 3001) · frontend `cd frontend && npm run dev` (port 5173).
- For code review, use the `/review` skill. For security checks, use the `/security-audit` skill.
