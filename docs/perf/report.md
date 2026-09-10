# Performance report: before vs after

Consolidated comparison of [`baseline.md`](./baseline.md) (main, before any change) and
[`after.md`](./after.md) (top of the stacked PR series). Both runs use the same deterministic
seed (`backend/scripts/seed-perf.js`): user `perf@example.com` with 50 clients and 50,000 work
entries, plus 4 other tenants with 2,500 entries each; in-memory SQLite, Node v24, 30 iterations
per endpoint (10 for heavy endpoints). Run with `cd backend && npm run perf:audit`.

Per-PR detail: [`indexes.md`](./indexes.md), [`auth.md`](./auth.md), [`reports.md`](./reports.md),
[`pagination.md`](./pagination.md).

## Headline

| | Before | After | Change |
|---|---:|---:|---:|
| Dashboard load (work-entry data) | 1 request, 199 ms, 10.3 MB | summary 4.2 ms / 52 B + `limit=5` page (~1 KB, extrapolated from the 50-row page) | **~99.9% less transfer, ~30x faster** |
| Work-entries list page | 199 ms p50, 10.3 MB (all 50k rows) | 2.4 ms p50, 10 KB (page of 50) | **-98.8% latency, -99.9% payload** |
| Auth SQL per authenticated request | 2 statements (SELECT + conditional INSERT) | 0 on cache hit, 1 UPSERT on first sight | -1 to -2 statements/request |
| CSV export | buffered rows -> temp file -> stream file -> unlink | `db.each` -> `res.write()` streaming | no temp files, no full-array materialization |
| Hot query plans | `USE TEMP B-TREE FOR ORDER BY` on list + report queries | composite indexes serve filter and order | temp sorts removed |

## Per-service latency (p50 / p95 ms)

### auth

| Endpoint | p50 before | p50 after | p95 before | p95 after | SQL stmts/req before -> after |
|---|---:|---:|---:|---:|---|
| POST /api/auth/login (existing user) | 1.16 | 1.14 | 2.30 | 2.39 | 1.0 -> 1.0 |
| GET /api/auth/me | 1.28 | 0.94 | 1.44 | 1.07 | 2.0 -> 1.0 |
| authenticateUser (via GET /api/clients/:id) | 1.13 | 0.90 | 2.28 | 1.28 | 2.0 -> 1.0 |

The middleware now does a single `INSERT ... ON CONFLICT(email) DO NOTHING` the first time an
email is seen, then serves subsequent requests from a bounded in-process `Set` with no DB access.
The remaining 1.0 stmt/req on `/me` and `/clients/:id` is the route's own query.

### clients

| Endpoint | p50 before | p50 after | p95 before | p95 after | SQL stmts/req before -> after |
|---|---:|---:|---:|---:|---|
| GET /api/clients | 1.40 | 1.06 | 1.62 | 1.16 | 2.0 -> 1.0 |
| GET /api/clients/:id | 1.10 | 0.81 | 1.23 | 1.23 | 2.0 -> 1.0 |

No changes to the clients routes; improvement comes entirely from the auth middleware
dropping its per-request SELECT.

### work-entries

| Endpoint | p50 before | p50 after | p95 before | p95 after | SQL stmts/req | Payload bytes before -> after |
|---|---:|---:|---:|---:|---|---:|
| GET /api/work-entries | 199.07 | 2.38 | 222.10 | 2.83 | 2.0 -> 2.0 (count + page) | 10,346,319 -> 10,384 |
| GET /api/work-entries?limit=200 | – | 2.98 | – | 3.86 | 2.0 | – -> 41,290 |
| GET /api/work-entries/summary (new) | – | 4.18 | – | 7.89 | 1.0 | – -> 52 |
| GET /api/work-entries?clientId= | 4.84 | 1.28 | 7.52 | 1.42 | 2.0 -> 2.0 | 204,267 -> 10,328 |
| GET /api/work-entries/:id | 1.06 | 0.78 | 1.34 | 3.31 | 2.0 -> 1.0 | 207 -> 207 |
| POST /api/work-entries | 1.57 | 1.09 | 1.88 | 2.49 | 4.0 -> 3.0 | 236 -> 236 |
| PUT /api/work-entries/:id | 1.48 | 0.99 | 2.32 | 1.67 | 5.0 -> 4.0 | 247 -> 247 |

The list endpoint is paginated (`limit` default 50 / max 200, `offset`) and returns
`pagination: { total, limit, offset, hasMore }`. The dashboard uses the new summary endpoint
(`COUNT(*)`, `SUM(hours)` scoped by `user_email`) instead of downloading every row.

### reports

| Endpoint | p50 before | p50 after | p95 before | p95 after | SQL stmts/req | Payload bytes |
|---|---:|---:|---:|---:|---|---:|
| GET /api/reports/client/:id | 4.37 | 4.73 | 7.37 | 7.09 | 3.0 -> 3.0 | 168,122 |
| GET /api/reports/export/csv/:id | 4.21 | 4.92 | 9.72 | 8.13 | 3.0 -> 2.0 | 70,942 |
| GET /api/reports/export/pdf/:id | 50.21 | 46.70 | 87.33 | 94.06 | 3.0 -> 3.0 | 99,237 -> 99,453 |

At ~1,000 rows per client these endpoints are serialization-bound (JSON / pdfkit), so wall-clock
latency is flat within run-to-run noise. The wins are structural: CSV no longer materializes the
row array, writes a temp file, or hits the filesystem at all (one fewer SQL statement because the
report totals come from a SQL aggregate instead of a JS reduce); PDF rows stream into the piped
document via `db.each`. `totalHours`/`entryCount` come from `SUM`/`COUNT` rather than reducing
over rows in JS.

## Query counts and SQL time

| Endpoint | SQL ms/req before | SQL ms/req after |
|---|---:|---:|
| GET /api/work-entries | 79.6 | 1.1 |
| GET /api/work-entries?clientId= | 1.8 | 0.1 |
| GET /api/reports/client/:id | 1.6 | 1.9 |
| GET /api/reports/export/csv/:id | 1.4 | 2.1 |
| GET /api/reports/export/pdf/:id | 1.5 | 5.4 |

(For the streamed endpoints the higher SQL ms is most likely an accounting artifact: with
`db.each` the statement stays open while each row callback runs, so the profiled statement
time includes the CSV/PDF serialization work that `db.all` previously did after the statement
finished. Wall-clock p50 for these endpoints did not regress.)

## EXPLAIN QUERY PLAN deltas

| Query | Before | After |
|---|---|---|
| work-entries list (`WHERE user_email=? ORDER BY date DESC, created_at DESC`) | `SEARCH we USING INDEX idx_work_entries_user_email` + `USE TEMP B-TREE FOR ORDER BY` | `SEARCH we USING INDEX idx_work_entries_user_date_created (user_email=?)` — no temp sort; `LIMIT/OFFSET` walks the index |
| work-entries list count (new) | – | `SEARCH we USING COVERING INDEX idx_work_entries_user_email` |
| work-entries list filtered (`user_email=? AND client_id=?`) | `SEARCH we USING INDEX idx_work_entries_client_id` + `USE TEMP B-TREE FOR ORDER BY` | `SEARCH we USING INDEX idx_work_entries_user_client_date (user_email=? AND client_id=?)` + temp B-tree only for the `created_at` tail of the ORDER BY |
| client report rows (`client_id=? AND user_email=? ORDER BY date DESC`) | `SEARCH ... idx_work_entries_client_id` + `USE TEMP B-TREE FOR ORDER BY` | `SEARCH ... idx_work_entries_user_client_date (user_email=? AND client_id=?)` — no temp sort |
| client report aggregate (SUM/COUNT) | `idx_work_entries_client_id` | `idx_work_entries_user_client_date (user_email=? AND client_id=?)` |
| user summary aggregate | `idx_work_entries_user_email` | `idx_work_entries_user_email` (unchanged) |
| auth user lookup | `COVERING INDEX sqlite_autoindex_users_1` | unchanged (and no longer executed on cache hits) |

Indexes added: `idx_work_entries_user_client_date (user_email, client_id, date)` and
`idx_work_entries_user_date_created (user_email, date, created_at)`. All pre-existing
single-column indexes were kept (see `indexes.md` for the reasoning).

## Payload-size reductions

| Page / call | Before | After |
|---|---:|---:|
| Dashboard: work-entry data | 10,346,319 B (full list) | 52 B summary + ~1 KB (`limit=5` page, extrapolated from 10,384 B / 50 rows) |
| Work-entries page: initial list | 10,346,319 B | 10,384 B (50 rows); 41,290 B at the 200-row cap |
| Work-entries filtered by client | 204,267 B | 10,328 B |

## Wins

- Dashboard and work-entries page no longer scale with the tenant's total entry count.
- Unfiltered list latency 199 ms -> 2.4 ms p50; SQL time 79.6 ms -> 1.1 ms per request.
- Auth middleware: 2 SQL statements per request -> 0 (cache hit) / 1 (first sight), which also
  shaves ~0.3 ms off every authenticated endpoint (clients, work-entry detail, POST/PUT).
- Temp B-tree sorts eliminated from the list and client-report queries via composite indexes.
- CSV export: no temp files, no full row array, correct RFC-4180 escaping of `description`.
- PDF export streams rows instead of materializing them.
- Client report totals computed in SQL.

## Regressions / caveats

- Report/export p50 latencies are within noise of baseline (+0.3 to +0.7 ms on ~4–5 ms). They
  are serialization-bound at this row count; the streaming changes target memory/disk, not CPU.
- PDF p95 is noisy (87 -> 94 ms) across runs of 10 iterations; p50 improved (50.2 -> 46.7 ms).
- `GET /api/work-entries` now issues a `COUNT(*)` alongside the page query (2 statements as
  before, but one is the count). At 50k rows it costs ~1 ms via the covering index.
- Deep `OFFSET` pages cost O(offset) index walk; keyset pagination would be the next step if
  users page deeply.
- The paginated response shape adds `pagination` metadata; `workEntries` is now a page (default
  50), so any client relying on receiving every row must pass `limit`/`offset`.
- Auth cache is per-process and bounded (10k emails); a user deleted from the DB out-of-band
  would still authenticate until process restart (the app never deletes users today).

## Functional guard

`e2e/` (Playwright) covers login/user creation via `x-user-email`, client creation, work-entry
create/edit/delete, dashboard summary (and asserts the dashboard never requests the unpaginated
list), client report, CSV and PDF export (200, `text/csv` / `application/pdf`, `attachment`
Content-Disposition, CSV escaping, `%PDF-` magic), and tenant isolation. Run:
`cd e2e && npm install && npm run install:browsers && npm run test:e2e` (starts backend :3001
and frontend :5173 automatically; set `E2E_REUSE_SERVERS=1` to use already-running dev servers).
Backend Jest suite: 171 tests passing.
