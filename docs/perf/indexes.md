# Composite indexes: EXPLAIN QUERY PLAN before/after

Dataset: `npm run perf:audit` seed (50 clients, 50,000 work_entries for the
audited user plus 4 background tenants with 2,500 entries each), `ANALYZE` run
after seeding so the planner has real statistics.

Indexes added in `backend/src/database/init.js`:

```sql
CREATE INDEX idx_work_entries_user_client_date  ON work_entries (user_email, client_id, date);
CREATE INDEX idx_work_entries_user_date_created ON work_entries (user_email, date, created_at);
```

## Plans

### `GET /api/work-entries` (`workEntries.js` list, `ORDER BY date DESC, created_at DESC`)

| | Plan |
|---|---|
| Before | `SCAN we USING INDEX idx_work_entries_date` → `SEARCH c USING INTEGER PRIMARY KEY` → **`USE TEMP B-TREE FOR RIGHT PART OF ORDER BY`** |
| After | `SEARCH we USING INDEX idx_work_entries_user_date_created (user_email=?)` → `SEARCH c USING INTEGER PRIMARY KEY` |

The full-table scan over the `date` index (all tenants) becomes a range search on
the user's own rows, already in the requested order, so the sort step disappears.

### `GET /api/work-entries?clientId=` (list filtered by client)

| | Plan |
|---|---|
| Before | `SEARCH we USING INDEX idx_work_entries_client_id (client_id=?)` → **`USE TEMP B-TREE FOR ORDER BY`** |
| After | `SEARCH we USING INDEX idx_work_entries_user_client_date (user_email=? AND client_id=?)` → `USE TEMP B-TREE FOR RIGHT PART OF ORDER BY` |

Both predicates are now served by the index and rows arrive ordered by `date`;
only the `created_at` tie-break still needs a sort.

### Report queries (`reports.js` client report / CSV / PDF, `WHERE client_id = ? AND user_email = ? ORDER BY date DESC`)

| | Plan |
|---|---|
| Before | `SEARCH work_entries USING INDEX idx_work_entries_client_id (client_id=?)` → **`USE TEMP B-TREE FOR ORDER BY`** |
| After | `SEARCH work_entries USING INDEX idx_work_entries_user_client_date (user_email=? AND client_id=?)` |

### Client aggregate (`SUM(hours)`, `COUNT(*)` per client)

| | Plan |
|---|---|
| Before | `SEARCH work_entries USING INDEX idx_work_entries_client_id (client_id=?)` |
| After | `SEARCH work_entries USING INDEX idx_work_entries_user_client_date (user_email=? AND client_id=?)` |

### User summary aggregate (`SUM(hours)`, `COUNT(*)` per user)

Unchanged: `SEARCH work_entries USING INDEX idx_work_entries_user_email (user_email=?)`.

## Existing single-column indexes

| Index | Decision | Reason |
|---|---|---|
| `idx_work_entries_user_email` | kept | Superseded in principle by the leftmost prefix of both composites, but the planner still picks it for the user-level aggregate and `init.test.js` asserts its creation. Dropping it would only save write amplification on inserts. |
| `idx_work_entries_client_id` | kept | Not a prefix of either composite (composites lead with `user_email`). No current query benefits from it after this change, but it backs the `client_id` foreign key on cascade deletes. |
| `idx_work_entries_date` | kept | Not a prefix of either composite; harmless and asserted by tests. |

## Latency impact

Row-count-bound endpoints are dominated by JSON/PDF serialisation rather than the
SQL step at this data size, so latency is roughly flat here; the wins are the
removed sort passes and the reduced rows visited (see `docs/perf/report.md` for
the consolidated before/after once the query and payload changes land).

| Endpoint | Baseline p50 | With indexes p50 |
|---|---:|---:|
| `GET /api/work-entries` | 199.07 ms | 194.43 ms |
| `GET /api/work-entries?clientId=` | 4.84 ms | 4.85 ms |
| `GET /api/reports/client/:id` | 4.37 ms | 4.45 ms |
| `GET /api/reports/export/csv/:id` | 4.21 ms | 4.74 ms |
| `GET /api/reports/export/pdf/:id` | 50.21 ms | 47.89 ms |
