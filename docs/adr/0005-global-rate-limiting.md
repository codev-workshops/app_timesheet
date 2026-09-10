# 0005. Global rate limiting with `express-rate-limit`

**Status:** Accepted

**Importance:** Medium

## Context

The backend should resist trivial abuse, and header-based identity
([ADR 0001](0001-x-user-email-header-auth.md)) offers no per-user throttle of
its own.

Verified against source:

- `backend/src/server.js`:

  ```js
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  });
  app.use(limiter);
  ```

  The limiter is mounted with `app.use` **before** any route, so it applies
  to every path including `/health`, and there is no separate, stricter
  limiter on `/api/auth/login`.
- `docker/overrides/server.js` contains an identical `rateLimit` block. The
  Docker image replaces `server.js` wholesale, so the two copies must be kept
  in sync by hand.
- Neither file calls `app.set('trust proxy', ...)`.
- `express-rate-limit` (v7, `backend/package.json`) uses its default
  in-memory `MemoryStore`; no external store is configured.
- `PROJECT_SUMMARY.md` claims "5 login attempts per 15 minutes per IP".
  **No such limiter exists.** Login is subject only to the global 100/15 min
  limit.

## Decision

Apply a single, application-wide `express-rate-limit` instance: 100 requests
per client IP per 15-minute window, backed by the default in-memory store.

## Consequences

- One line of configuration provides baseline protection against runaway
  clients and naive scripted abuse.
- **Coarse**: a busy legitimate user (the SPA issues several requests per
  page, and TanStack Query refetches on focus) can hit the cap; `/health`
  probes also consume budget.
- **Missing `trust proxy`**: behind a reverse proxy or load balancer,
  `req.ip` is the proxy's address, so all users share one bucket and a single
  noisy client can lock everyone out. Setting `trust proxy` appropriately is
  required before deploying behind a proxy.
- **In-memory store**: counters are per-process, reset on restart, and are
  not shared across replicas, so the effective limit scales with the number
  of instances. A shared store (e.g. Redis) would be needed for a horizontal
  deployment.
- The limit is duplicated in `docker/overrides/server.js`; changes made to
  one file are silently absent from the other.
- `PROJECT_SUMMARY.md`'s "5 login attempts per 15 minutes" statement is
  incorrect. `README.md`'s checklist item "Review and adjust rate limiting
  settings" is accurate advice.
