# 0006. Empty `API_BASE_URL` and the Vite dev proxy

**Status:** Accepted

**Importance:** Medium

## Context

The frontend (Vite, port 5173) and backend (Express, port 3001) run as
separate dev servers. Cross-origin calls would require CORS handling and a
configurable API URL in the client.

Verified against source:

- `frontend/src/api/client.ts`:

  ```ts
  // Use empty string to make requests relative to the current origin
  // Vite proxy will forward /api requests to the backend
  const API_BASE_URL = '';
  ```

  All Axios calls use paths like `/api/clients` relative to the page origin.
- `frontend/vite.config.ts` proxies `/api` to `http://localhost:3001` with
  `changeOrigin: true`.
- `frontend/.env` and `frontend/.env.example` define
  `VITE_API_URL=http://localhost:3001`, and `README.md` instructs users to set
  it — but `grep -rn VITE_API_URL frontend/src` finds no reference.
  `import.meta.env.VITE_API_URL` is never read; the variable is
  **effectively unused**.
- `docker/overrides/server.js` serves the built SPA from the same Express
  process in production (`express.static` + `index.html` fallback), so
  `/api/...` is same-origin there as well.
- `backend/src/server.js` still configures `cors({ origin: FRONTEND_URL ||
  'http://localhost:5173', credentials: true })`; with the proxy in place
  this is not exercised by the browser in development.

## Decision

The API client always issues same-origin relative requests. In development,
the Vite dev server proxies `/api` to the backend; in the Docker production
image, Express serves both the SPA and the API from one origin.

## Consequences

- No CORS complexity in the browser, no environment-specific build of the
  frontend, and the same bundle works in dev and in the Docker image.
- `VITE_API_URL` is misleading: setting it has no effect. It should either
  be wired into `API_BASE_URL` or removed from `.env*` and `README.md`.
- Deploying the frontend on a different origin from the API (e.g. static
  hosting + separate API host) is **not supported** without changing
  `API_BASE_URL` and revisiting the backend CORS configuration.
- Running the frontend against a backend on a non-default port requires
  editing `vite.config.ts`, not an env var.
- The `/health` endpoint is not under `/api`, so `apiClient.healthCheck()`
  hits the Vite server (404) in development and only reaches Express in the
  single-origin Docker deployment.
