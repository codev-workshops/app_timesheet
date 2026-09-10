# 0001. Trust-based `x-user-email` header authentication

**Status:** Accepted

**Importance:** Critical

## Context

The application needs to know which user is making each API request so that
data can be scoped per user (see [ADR 0004](0004-user-email-tenancy-key.md)).
It was built for a trusted internal network with no password or identity
provider available.

`README.md` and `PROJECT_SUMMARY.md` describe "JWT-based authentication with
24-hour token expiration" and a `JWT_SECRET` environment variable. **This is
not what the code does.** Verified against source:

- `backend/src/middleware/auth.js` — `authenticateUser` reads
  `req.headers['x-user-email']`, returns `401` if absent, `400` if it fails a
  simple email regex, otherwise sets `req.userEmail` and calls `next()`. No
  token is parsed, verified, or signed anywhere.
- `frontend/src/api/client.ts` — an Axios request interceptor reads
  `localStorage.getItem('userEmail')` and copies it verbatim into the
  `x-user-email` header. A response interceptor clears the stored email and
  redirects to `/login` on `401`.
- `backend/package.json` declares `jsonwebtoken` as a dependency, but
  `grep -rn jsonwebtoken backend/src` finds no `require`. The only JWT-related
  code is an unused `jwt` block in `backend/src/config/production.js`, which
  is not imported by any module.
- `backend/src/routes/auth.js` `POST /api/auth/login` accepts `{ email }`,
  validates it with Joi, and returns the user object — no token, cookie, or
  session is issued.

## Decision

Identity is asserted by the client via the `x-user-email` request header and
trusted as-is by the backend. The frontend persists the chosen email in
`localStorage` and attaches it to every request. There is no password, no
signed token, and no server-side session.

## Consequences

- **Zero-friction login**: any syntactically valid email grants access
  immediately, which suits demos and a fully trusted network.
- **No real authentication**: any caller can impersonate any user by setting
  the header. Per-user data isolation ([ADR 0004](0004-user-email-tenancy-key.md))
  is therefore only as strong as the network boundary around the API.
- **Not production-safe** without fronting the API with a real identity
  layer (SSO / reverse-proxy auth) that sets or validates the header.
- `jsonwebtoken` is dead weight in `backend/package.json` and can be removed;
  `backend/src/config/production.js` is unused by the runtime.
- `README.md` / `PROJECT_SUMMARY.md` statements about JWT tokens, token
  expiry, `JWT_SECRET`, and "Axios interceptors for automatic JWT token
  injection" are incorrect and should be read as aspirational.
