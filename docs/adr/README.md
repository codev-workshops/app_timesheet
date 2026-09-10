# Architecture Decision Records

This directory records the significant architectural decisions embodied in
timesheet-app. Each record describes what the code *actually does* today,
verified against the cited source files — not what the top-level `README.md`
or `PROJECT_SUMMARY.md` claim (several of those claims are inaccurate and are
called out in the relevant ADRs).

## Process

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-slug.md`, using
   the next free four-digit number.
2. Fill in every section. Keep **Context** factual and cite the source files
   (`path:line` where useful) so a reader can verify the record.
3. Set **Status** to `Proposed` while under discussion, `Accepted` once agreed.
   A superseded record keeps its file; set its status to
   `Superseded by NNNN` and link the replacement.
4. Set **Importance** (see scale below) so readers can prioritise.
5. Add a row to the index table below.
6. ADRs are documentation only. If a decision changes, write a new ADR rather
   than editing history, and update the runtime code in a separate change.

### Importance scale

| Level | Meaning |
|-------|---------|
| Critical | Affects security posture or data durability; must be understood before deploying beyond a trusted dev environment. |
| High | Shapes core behaviour or the data model; changing it is a substantial refactor. |
| Medium | Operational or integration concern with known limits and a clear migration path. |
| Low | Convention or tooling choice; low risk to change. |

## Index

| ADR | Title | Status | Importance |
|-----|-------|--------|------------|
| [0001](0001-x-user-email-header-auth.md) | Trust-based `x-user-email` header authentication | Accepted | Critical |
| [0002](0002-auto-provision-users.md) | Auto-provision users on first authenticated request | Accepted | High |
| [0003](0003-in-memory-sqlite.md) | In-memory SQLite database (`:memory:`) | Accepted | Critical |
| [0004](0004-user-email-tenancy-key.md) | `user_email` as the tenancy key | Accepted | High |
| [0005](0005-global-rate-limiting.md) | Global rate limiting with `express-rate-limit` | Accepted | Medium |
| [0006](0006-empty-api-base-url-vite-proxy.md) | Empty `API_BASE_URL` and the Vite dev proxy | Accepted | Medium |
| [0007](0007-export-strategies.md) | Report export strategies: CSV temp file vs PDF streaming | Accepted | Medium |
| [0008](0008-split-authcontext.md) | Split `AuthContext` across two files for Fast Refresh | Accepted | Low |
| [0009](0009-tech-stack.md) | Technology stack | Accepted | Low |
