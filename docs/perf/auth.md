# Auth service: before/after

Measured with `npm run perf:audit` on the standard perf seed (5 users, 50 clients, 50,000 work entries).

## Change

`backend/src/middleware/auth.js` previously ran `SELECT email FROM users WHERE email = ?` on every
authenticated request and, on a miss, a second `INSERT INTO users (email) VALUES (?)`.

It now runs a single idempotent UPSERT on first sight of an email and remembers known emails in a
bounded in-process `Set` (10,000 entries, oldest evicted first), so repeat requests skip the database:

```sql
INSERT INTO users (email) VALUES (?) ON CONFLICT(email) DO NOTHING
```

Responses are unchanged: `401` for a missing header, `400` for an invalid email, `500 { error: 'Failed to create user' }`
on a DB error. `req.userEmail` is still set before `next()`. A failed UPSERT is not cached, so the next
request retries.

## Results

| Endpoint | p50 before | p50 after | p95 before | p95 after | SQL stmts/req before | after |
|---|---:|---:|---:|---:|---:|---:|
| GET /api/auth/me | 1.28 ms | 0.78 ms | 1.44 ms | 1.03 ms | 2.0 | 1.0 |
| authenticateUser (via GET /api/clients/:id) | 1.13 ms | 0.79 ms | 2.28 ms | 1.32 ms | 2.0 | 1.0 |
| POST /api/auth/login (existing user) | 1.16 ms | 1.06 ms | 2.30 ms | 2.26 ms | 1.0 | 1.0 |

Every authenticated endpoint in the app drops one SQL round-trip per request (the audit's "SQL stmts/req"
column is down by 1 across the clients, work-entries and reports services). `/login` is unchanged by design.
