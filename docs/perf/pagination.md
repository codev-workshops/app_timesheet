# Work-entries pagination + dashboard summary

Dataset: `PERF_SEED` (perf@example.com, 50 clients, 50,000 work entries, 4 other tenants x 2,500 entries).

## Changes

- `GET /api/work-entries` now accepts `limit` (default 50, max 200) and `offset` (default 0),
  validated via Joi (`workEntryListQuerySchema`). Response gains
  `pagination: { total, limit, offset, hasMore }`. Ordering (`date DESC, created_at DESC`)
  and `user_email` scoping are unchanged; the `clientId` filter still works.
- New `GET /api/work-entries/summary` returns
  `{ summary: { entryCount, totalHours } }` from a single
  `COUNT(*)` / `COALESCE(SUM(hours), 0)` aggregate scoped by `user_email`.
- Frontend: `DashboardPage` uses the summary endpoint plus a `limit=5` page for recent entries
  instead of fetching every entry; `WorkEntriesPage` uses MUI `TablePagination` backed by
  `limit`/`offset`. Both go through TanStack Query hooks in `src/hooks/useWorkEntries.ts`.

## Measured (before = baseline.md, after = this branch)

| Endpoint | p50 before | p50 after | p95 before | p95 after | Payload before | Payload after |
|---|---:|---:|---:|---:|---:|---:|
| `GET /api/work-entries` (default page) | 199.07 ms | 2.23 ms | 222.10 ms | 2.88 ms | 10,346,319 B | 10,384 B |
| `GET /api/work-entries?limit=200` | – | 2.82 ms | – | 3.67 ms | – | 41,290 B |
| `GET /api/work-entries/summary` (dashboard) | 199.07 ms* | 4.12 ms | 222.10 ms* | 5.98 ms | 10,346,319 B* | 52 B |

\* Dashboard previously called the unpaginated list and reduced 50,000 rows client-side.

The dashboard now transfers ~10 KB (summary + 5 recent rows) instead of ~10 MB; the list page
transfers 10–41 KB per page.

## EXPLAIN QUERY PLAN

```
-- list page
SEARCH we USING INDEX idx_work_entries_user_date_created (user_email=?)
SEARCH c USING INTEGER PRIMARY KEY (rowid=?)
-- LIMIT/OFFSET walks the index in order; no temp B-tree

-- total count
SEARCH we USING COVERING INDEX idx_work_entries_user_email (user_email=?)

-- summary
SEARCH work_entries USING COVERING INDEX idx_work_entries_user_client_date (user_email=?)
```

Note: `OFFSET` still skips rows via index walk, so deep pages cost O(offset); acceptable for the
UI's page sizes. Keyset pagination would be the next step if deep paging becomes common.
