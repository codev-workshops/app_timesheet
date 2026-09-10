# 0003. In-memory SQLite database (`:memory:`)

**Status:** Accepted

**Importance:** Critical

## Context

The original requirements called for an in-memory database, and the code
comment in `backend/src/database/init.js` says so explicitly:
`// Use in-memory database as specified in requirements`.

Verified against source (`backend/src/database/init.js`):

- `getDatabase()` lazily constructs `new sqlite3.Database(':memory:')` and
  caches it in a module-level `db` variable. The path is **hardcoded**; no
  environment variable is consulted.
- `initializeDatabase()` runs `CREATE TABLE IF NOT EXISTS` for `users`,
  `clients`, and `work_entries` plus four indexes inside `db.serialize()`.
- The Docker build ships a different implementation:
  `docker/overrides/database/init.js` reads `process.env.DATABASE_PATH`
  (defaulting to `:memory:`) and `docker/Dockerfile` sets
  `DATABASE_PATH=/app/data/timesheet.db`. That override also enables
  `PRAGMA foreign_keys = ON` and omits the `department`/`email` client
  columns, so its schema differs from the main backend.

### `closeDatabase` state machine

`closeDatabase()` uses two module-level flags, `isClosing` and `isClosed`:

| State | Behaviour |
|-------|-----------|
| `isClosed` | resolve immediately |
| `isClosing` | poll every 10 ms until `isClosed`, then resolve |
| `!db` | resolve immediately (never opened) |
| otherwise | set `isClosing`, call `db.close()`, then set `isClosed`, clear `isClosing`, null out `db`, resolve |

`getDatabase()` resets both flags when it creates a new connection. The
runtime never calls `closeDatabase` — `backend/src/server.js` has no shutdown
hook. Its purpose is **test support**: Jest suites (see
`backend/src/__tests__/database/init.test.js` and route tests) open and close
the singleton repeatedly, sometimes concurrently, and the flags make repeated
or overlapping `closeDatabase()` calls idempotent.

## Decision

Use a single, process-wide, in-memory SQLite connection created on first use.
Schema is created at startup with idempotent DDL. No persistence, migration,
or connection-pool layer exists.

## Consequences

- Zero setup: `npm run dev` works with no database service or file.
- **All data is lost on every backend restart**, including `nodemon` reloads
  during development. `README.md` states this correctly.
- Not horizontally scalable: each process has its own private database.
- `CREATE TABLE IF NOT EXISTS` is effectively a no-op guard since the schema
  never survives a restart; there is no migration story for schema changes.
- Switching to a file database is a one-line change in `getDatabase()`, but
  the Docker override shows how the two copies of `init.js` can drift.
- Test isolation relies on the `closeDatabase` state machine rather than on
  per-test databases; `backend/src/__tests__/setup.js` additionally mocks
  `sqlite3` globally, so most tests never touch a real SQLite instance.
