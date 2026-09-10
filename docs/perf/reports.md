# Reports service: before/after

Measured with `npm run perf:audit` on the standard perf seed (5 users, 50 clients, 50,000 work entries;
~1,000 entries per client for the audited user).

## Changes (`backend/src/routes/reports.js`)

| Endpoint | Before | After |
|---|---|---|
| `GET /client/:id` | `db.all` rows, `reduce` in JS for `totalHours`, `rows.length` for `entryCount` | `db.get` `SELECT COUNT(*), COALESCE(SUM(hours),0)` (served by `idx_work_entries_user_client_date`), then `db.all` rows |
| `GET /export/csv/:id` | `db.all` → `csv-writer` → temp file under `backend/temp` → `res.download` → `fs.unlink` | `db.each` → `res.write()` per row, `res.end()` in the completion callback; RFC 4180 quoting for `, " \r \n`; no `csv-writer`/`fs`/`path`, no temp dir |
| `GET /export/pdf/:id` | `db.all` → `forEach` into piped `PDFDocument` | totals via the aggregate query, then `db.each` streaming rows into the already-piped document |

Error semantics for CSV: a DB error before the first row still yields `500 { error: 'Internal server error' }`
(the `text/csv` headers are removed first). Once rows have been written the stream is logged and ended.

## Results

| Endpoint | p50 before | p50 after | p95 before | p95 after | SQL stmts/req before | after |
|---|---:|---:|---:|---:|---:|---:|
| GET /api/reports/client/:id | 4.37 ms | 4.68 ms | 7.37 ms | 7.04 ms | 3.0 | 3.0 |
| GET /api/reports/export/csv/:id | 4.21 ms | 4.78 ms | 9.72 ms | 7.08 ms | 3.0 | 2.0 |
| GET /api/reports/export/pdf/:id | 50.21 ms | 46.80 ms | 87.33 ms | 87.85 ms | 3.0 | 3.0 |

(SQL statement counts include the auth middleware; after PR 3 auth costs 0 statements on cache hit, so the
client report and PDF each run client lookup + aggregate + rows, and the CSV runs client lookup + rows.)

Latency is within noise at ~1,000 rows per client: these endpoints are dominated by JSON/PDF serialisation
rather than the query. The material wins are:

- CSV no longer materialises the row array or touches the filesystem (temp file write + read + unlink per
  request), so memory and disk use are O(1) in the number of rows and the response starts as the first row
  arrives.
- PDF no longer holds every row in memory before drawing; it renders as rows arrive.
- Totals come from an indexed aggregate rather than a JS `reduce` over every row.
- CSV output is byte-identical to the previous `csv-writer` output for the seeded data (70,942 bytes both
  before and after) and now correctly escapes descriptions containing commas, quotes or newlines.
