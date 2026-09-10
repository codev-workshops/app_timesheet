# 0002. Auto-provision users on first authenticated request

**Status:** Accepted

**Importance:** High

## Context

With header-based identity ([ADR 0001](0001-x-user-email-header-auth.md))
there is no registration step. The `clients` and `work_entries` tables
declare `FOREIGN KEY (user_email) REFERENCES users (email)`
(`backend/src/database/init.js`), so a `users` row must exist before a user
can own data.

Verified against source:

- `backend/src/middleware/auth.js` — after validating the header,
  `authenticateUser` runs `SELECT email FROM users WHERE email = ?`; if no row
  is returned it runs `INSERT INTO users (email) VALUES (?)` and then calls
  `next()`. This happens on **every protected route**, not just login.
- `backend/src/routes/auth.js` — `POST /api/auth/login` performs the same
  select-or-insert and responds with `{ message, user: { email, createdAt } }`
  (`200` for an existing user, `201` for a newly created one). It does not
  issue credentials; it simply echoes the user object so the frontend can
  populate its `AuthContext`.
- `GET /api/auth/me` returns the stored `users` row for `req.userEmail`.

## Decision

Users are created implicitly. The first request carrying a previously unseen
(but well-formed) `x-user-email` header inserts a `users` row inside the auth
middleware. `/api/auth/login` is a convenience endpoint that does the same
thing and returns the user object; it is not a prerequisite for using the
API.

## Consequences

- No onboarding flow to build or maintain; new users can start entering time
  immediately.
- Any typo or arbitrary string that passes the email regex creates a new,
  empty tenant. There is no way to list, disable, or delete users via the API.
- The `users` table grows with every distinct header value ever seen; because
  the database is in-memory ([ADR 0003](0003-in-memory-sqlite.md)) this
  resets on restart.
- Auth middleware performs a DB round-trip (and possibly a write) on every
  request, which couples request latency to database availability.
- The "login" concept in the UI is cosmetic: `AuthProvider.login` calls the
  endpoint and stores the email in `localStorage`
  (`frontend/src/contexts/AuthContext.tsx`), but the backend would have
  provisioned the user on the next request anyway.
