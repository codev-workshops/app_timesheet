# 0007. Report export strategies: CSV temp file vs PDF streaming

**Status:** Accepted

**Importance:** Medium

## Context

`backend/src/routes/reports.js` exposes per-client reports in three forms:
JSON (`GET /client/:clientId`), CSV (`GET /export/csv/:clientId`), and PDF
(`GET /export/pdf/:clientId`). All three verify client ownership and fetch
`work_entries` with the same `user_email`-scoped queries
([ADR 0004](0004-user-email-tenancy-key.md)), then diverge in how they
produce the download. The two export paths use different libraries with
different I/O models.

Verified against source (`backend/src/routes/reports.js`):

**CSV** uses `csv-writer`'s `createObjectCsvWriter`, which only writes to a
file path:

1. Build `filename` from the sanitised client name and an ISO timestamp.
2. `tempPath = path.join(__dirname, '../../temp', filename)`; create the
   `backend/temp/` directory if missing.
3. `csvWriter.writeRecords(workEntries)` writes the file to disk.
4. `res.download(tempPath, filename, cb)` streams it to the client.
5. In the download callback, `fs.unlink(tempPath)` removes the file
   (errors are logged, not surfaced).

**PDF** uses `pdfkit`, which is a writable stream:

1. Set `Content-Type: application/pdf` and a `Content-Disposition`
   attachment header.
2. `doc.pipe(res)` streams directly to the HTTP response.
3. Write title, totals, a header row, and one row per entry (with a naive
   `if (y > 700) doc.addPage()` page break and a rule every 5 rows).
4. `doc.end()` finalises the stream.

No temp file is created for PDF.

## Decision

Accept two export mechanisms dictated by the chosen libraries: CSV is
materialised to a temp file under `backend/temp/` and deleted after send;
PDF is generated in-process and piped straight to the response.

## Consequences

- Both formats are implemented with minimal code on top of well-known
  libraries.
- **CSV path has filesystem side effects**: the process needs write access
  to `backend/temp/`; a crash between write and unlink leaks a file; two
  requests for the same client within the same millisecond would collide on
  `filename`. `backend/.gitignore` excludes `temp/` so leaked files are not
  committed, but they are also never cleaned up.
- **CSV double-buffers** (disk then network) while PDF streams; for large
  entry sets the CSV path uses more disk and latency, the PDF path holds
  fewer resources.
- Once `doc.pipe(res)` has started, an error cannot change the HTTP status;
  the client may receive a truncated PDF rather than a JSON error.
- Streaming PDF also means the layout is computed on the fly; the
  hardcoded x-positions and `y > 700` check are not robust to long
  descriptions.
- **Least-tested route**: `backend/TEST_COVERAGE_REPORT.md` records
  `reports.js` at 50.94% line coverage — the lowest of all route modules.
  `backend/src/__tests__/setup.js` mocks `sqlite3`, and the
  `reports.test.js` "Success Path" suites cover the happy path with mocked
  data, but temp-file cleanup failures, filename collisions, and mid-stream
  PDF errors are not exercised. Changes here should be accompanied by new
  tests.
