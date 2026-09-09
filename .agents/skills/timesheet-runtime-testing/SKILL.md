---
name: timesheet-runtime-testing
description: Run local full-feature UI and observability checks for the timesheet app.
---

## Local setup
- Install frontend dependencies with `npm install` in `frontend/`; backend dependencies likewise if missing.
- Start backend in `backend/` with `OTEL_TRACES_EXPORTER=console npm start`, capturing stdout/stderr to a temporary log. This preloads tracing before Express; starting `node src/server.js` alone does not.
- Start Vite in `frontend/` with `npm run dev -- --host 0.0.0.0`. Default ports are 3001 and 5173. Vite proxies `/api`, not `/metrics` or `/health`; open the backend port directly for those.
- The default backend uses in-memory SQLite: restart loses test data. Keep it running throughout the flow.

## Devin Secrets Needed
None for local testing. Login accepts an email and creates the user; the browser stores `userEmail` and sends `x-user-email`. Use a unique synthetic test email to isolate data.

## UI path
Sidebar Clients → Add Client → Create; Work Entries → Add Work Entry → select client, hours/date/description → Create; Reports → Select Client. CSV/PDF controls are icon buttons labeled by tooltips "Export as CSV" and "Export as PDF".
Check actual browser downloads and PDF rendering, not just HTTP 200. Exported dates might be epoch milliseconds even when UI dates are formatted; flag this separately from observability.

## Observability checks
- Parse only Winston JSON lines from captured stdout. OTel console span output is intentionally multiline and must not be mistaken for broken JSON app logs.
- Authenticated client/work/report completions should include requestId and userEmail. Login, health, metrics are not authenticated.
- Use UI for normal traffic. For diagnostic authenticated requests use the browser context with its normal email-header auth, not copied cookies or authenticated curl.
- Probe two nonexistent client IDs plus one real ID; metrics should group them under `/api/clients/:id` with separate 200 and 404 status labels.
- Unauthenticated curl can verify `/health`, `/metrics`, and echoed `x-request-id`. Health produces no completion log; health and metrics produce no HTTP metric series.
- Match histogram count and +Inf bucket to request counters, inspect default process metrics, and wait for the OTel batch exporter before checking span names.
- Console exporter testing does not prove OTLP collector ingestion. Explicitly report that scope limitation.
