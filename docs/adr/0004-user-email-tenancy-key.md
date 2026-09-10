# 0004. `user_email` as the tenancy key

**Status:** Accepted

**Importance:** High

## Context

The app is described as multi-tenant: each user sees only their own clients
and work entries. Identity arrives as an email string
([ADR 0001](0001-x-user-email-header-auth.md)), so the natural key for
ownership is that email.

Verified against source:

- `backend/src/database/init.js` — `users.email` is the `PRIMARY KEY`;
  `clients.user_email` and `work_entries.user_email` are `TEXT NOT NULL` with
  `FOREIGN KEY ... REFERENCES users (email) ON DELETE CASCADE`, and both have
  a dedicated index (`idx_clients_user_email`,
  `idx_work_entries_user_email`). Note the main backend never runs
  `PRAGMA foreign_keys = ON`, so SQLite does not enforce these constraints
  (the Docker override does enable it).
- `backend/src/routes/clients.js`, `workEntries.js`, `reports.js` — every
  `SELECT`, `UPDATE`, and `DELETE` includes `user_email = ?` bound to
  `req.userEmail`; every `INSERT` writes `req.userEmail` into `user_email`.
  Reports and work-entry routes first verify the client belongs to the user
  (`SELECT ... FROM clients WHERE id = ? AND user_email = ?`) before reading
  its entries.
- `AGENTS.md` codifies the rule: "Every DB query must be parameterized (`?`
  placeholders) and scoped by `user_email`."

## Decision

Tenant isolation is implemented as row-level filtering on a denormalised
`user_email` column present on every owned table. The filter value is taken
directly from the authenticated request (`req.userEmail`). There is no
separate tenant/organisation entity and no role model.

## Consequences

- Simple to reason about and audit: every query in the routes carries the
  same predicate, and the indexes keep it cheap.
- Isolation is exactly as strong as the identity mechanism. Because
  `x-user-email` is client-supplied and unverified, **any caller can read or
  mutate any tenant's data by changing the header**. The tests under
  `Data Isolation` in `backend/src/__tests__/routes/*.test.js` prove the
  filtering works, not that it is secure.
- Renaming a user's email means orphaning their data (there is no user-id
  indirection). Cascading deletes are declared but not enforced in the main
  backend because foreign keys are off.
- Denormalising `user_email` onto `work_entries` (in addition to
  `clients.user_email`) allows single-table filtering without a join, at the
  cost of a redundant column that must be kept consistent by application code.
- Adding teams, shared clients, or admin roles would require a new tenancy
  model; `README.md`'s "Known Limitations" lists "No user roles" and
  "Multi-tenancy support" as a future enhancement.
