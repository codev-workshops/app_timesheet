# 0009. Technology stack

**Status:** Accepted

**Importance:** Low

## Context

The application is a small internal time-tracking tool that needed to be
runnable with no external services. The stack below is derived from the
declared dependencies in `backend/package.json` and `frontend/package.json`,
plus what the source actually imports.

## Decision

### Backend (`backend/package.json`)

| Concern | Choice | Notes |
|---------|--------|-------|
| Runtime / framework | Node.js, `express` ^4 | CommonJS modules; `node:20-alpine` in `docker/Dockerfile` |
| Database | `sqlite3` ^5 | In-memory, see [ADR 0003](0003-in-memory-sqlite.md) |
| Validation | `joi` ^17 | Schemas in `backend/src/validation/schemas.js`; `400 { error }` on failure |
| Security headers | `helmet` ^7 | Defaults in `server.js`; custom CSP in `docker/overrides/server.js` |
| CORS | `cors` ^2 | Origin from `FRONTEND_URL`, default `http://localhost:5173` |
| Rate limiting | `express-rate-limit` ^7 | See [ADR 0005](0005-global-rate-limiting.md) |
| Logging | `morgan` ^1 | `combined` format to stdout |
| CSV export | `csv-writer` ^1 | File-based, see [ADR 0007](0007-export-strategies.md) |
| PDF export | `pdfkit` ^0.13 | Streamed, see [ADR 0007](0007-export-strategies.md) |
| **Unused** | `jsonwebtoken` ^9 | Declared but never `require`d, see [ADR 0001](0001-x-user-email-header-auth.md) |
| Testing | `jest` ^29, `supertest` ^6 | `sqlite3` mocked globally in `src/__tests__/setup.js`; coverage thresholds in `jest.config.js` |
| Dev | `nodemon` ^3 | `npm run dev` |

### Frontend (`frontend/package.json`)

| Concern | Choice | Notes |
|---------|--------|-------|
| UI framework | `react` / `react-dom` ^19 | ESM, TypeScript ~5.9 strict |
| Build / dev server | `vite` ^7, `@vitejs/plugin-react` | Dev proxy for `/api`, see [ADR 0006](0006-empty-api-base-url-vite-proxy.md) |
| Component library | `@mui/material` ^7, `@mui/icons-material`, `@mui/x-date-pickers` ^8, `@emotion/*` | `frontend/AGENTS.md`: MUI only, no raw HTML inputs |
| Server state | `@tanstack/react-query` ^5 | All server state via hooks in `src/hooks/` |
| HTTP client | `axios` ^1 | Single `ApiClient` in `src/api/client.ts` with header interceptor |
| Routing | `react-router-dom` ^7 | |
| Dates | `date-fns` ^4 | |
| **Unused** | `bootstrap` ^5 | Declared but never imported under `frontend/src` |
| Lint | `eslint` ^9 flat config, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` (`reactRefresh.configs.vite`) | See [ADR 0008](0008-split-authcontext.md) |

### Rationale

- Express + SQLite keeps the backend a single process with zero
  infrastructure, matching the "runs anywhere" requirement.
- Joi gives declarative request validation with consistent `400` responses.
- React 19 + MUI + TanStack Query is a mainstream SPA combination with strong
  TypeScript support; Vite provides fast dev feedback and the `/api` proxy.
- Jest/Supertest with a mocked `sqlite3` lets the test suite run without a
  native build of SQLite.

## Consequences

- Low operational footprint; `npm install` in each folder is the full setup.
- SQLite and the in-process rate limiter constrain the app to a single
  instance (see ADRs 0003 and 0005).
- Dependency hygiene issues exist: `jsonwebtoken` is unused on the backend,
  and `bootstrap` is declared but never imported on the frontend. Removing unused
  packages would shrink installs and reduce confusion about the auth model.
- Express 4 and `pdfkit` 0.13 are older majors; upgrading either is a
  deliberate future decision.
