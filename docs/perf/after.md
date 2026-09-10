# Performance audit

- Generated: 2026-09-10T08:33:49.078Z
- Node v24.19.0, in-memory SQLite
- Dataset: 5 user, 50 clients, 50000 work entries (seeded in 1733ms)
- Default iterations per endpoint: 30 (heavy endpoints: 10)

## Service: auth

| Endpoint | Status | p50 ms | p95 ms | max ms | SQL stmts/req | SQL ms/req | Payload bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| POST /api/auth/login (existing user) | 200 | 1.14 | 2.39 | 18.27 | 1.0 | 0.3 | 100 |
| GET /api/auth/me | 200 | 0.94 | 1.07 | 1.79 | 1.0 | 0.0 | 71 |
| authenticateUser (via GET /api/clients/:id) | 200 | 0.90 | 1.28 | 1.94 | 1.0 | 0.2 | 196 |

<details><summary>SQL executed by POST /api/auth/login (existing user) (first iteration)</summary>

- 4ms `SELECT email, created_at FROM users WHERE email = ?`

</details>

<details><summary>SQL executed by GET /api/auth/me (first iteration)</summary>

- 0ms `INSERT INTO users (email) VALUES (?) ON CONFLICT(email) DO NOTHING`
- 0ms `SELECT email, created_at FROM users WHERE email = ?`

</details>

<details><summary>SQL executed by authenticateUser (via GET /api/clients/:id) (first iteration)</summary>

- 0ms `SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE id = ? AND user_email = ?`

</details>

## Service: clients

| Endpoint | Status | p50 ms | p95 ms | max ms | SQL stmts/req | SQL ms/req | Payload bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| GET /api/clients | 200 | 1.06 | 1.16 | 1.23 | 1.0 | 0.1 | 9350 |
| GET /api/clients/:id | 200 | 0.81 | 1.23 | 2.08 | 1.0 | 0.1 | 196 |

<details><summary>SQL executed by GET /api/clients (first iteration)</summary>

- 0ms `SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE user_email = ? ORDER BY name`

</details>

<details><summary>SQL executed by GET /api/clients/:id (first iteration)</summary>

- 0ms `SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE id = ? AND user_email = ?`

</details>

## Service: work-entries

| Endpoint | Status | p50 ms | p95 ms | max ms | SQL stmts/req | SQL ms/req | Payload bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| GET /api/work-entries | 200 | 2.38 | 2.83 | 2.83 | 2.0 | 1.1 | 10384 |
| GET /api/work-entries?limit=200 | 200 | 2.98 | 3.86 | 6.74 | 2.0 | 1.4 | 41290 |
| GET /api/work-entries/summary | 200 | 4.18 | 7.89 | 9.03 | 1.0 | 4.2 | 52 |
| GET /api/work-entries?clientId= | 200 | 1.28 | 1.42 | 1.95 | 2.0 | 0.1 | 10328 |
| GET /api/work-entries/:id | 200 | 0.78 | 3.31 | 4.30 | 1.0 | 0.2 | 207 |
| POST /api/work-entries | 201 | 1.09 | 2.49 | 3.74 | 3.0 | 0.4 | 236 |
| PUT /api/work-entries/:id | 200 | 0.99 | 1.67 | 3.47 | 4.0 | 0.2 | 247 |

<details><summary>SQL executed by GET /api/work-entries (first iteration)</summary>

- 1ms `SELECT COUNT(*) AS total FROM work_entries we WHERE we.user_email = ?`
- 0ms `SELECT we.id, we.client_id, we.hours, we.description, we.date, we.created_at, we.updated_at, c.name as client_name FROM work_entries we JOIN clients c ON we.client_id = c.id WHERE we.user_email = ? ORDER BY we.date DESC, we.created_at DESC LIMIT ? OFFSET ?`

</details>

<details><summary>SQL executed by GET /api/work-entries?limit=200 (first iteration)</summary>

- 1ms `SELECT COUNT(*) AS total FROM work_entries we WHERE we.user_email = ?`
- 0ms `SELECT we.id, we.client_id, we.hours, we.description, we.date, we.created_at, we.updated_at, c.name as client_name FROM work_entries we JOIN clients c ON we.client_id = c.id WHERE we.user_email = ? ORDER BY we.date DESC, we.created_at DESC LIMIT ? OFFSET ?`

</details>

<details><summary>SQL executed by GET /api/work-entries/summary (first iteration)</summary>

- 6ms `SELECT COUNT(*) AS entryCount, COALESCE(SUM(hours), 0) AS totalHours FROM work_entries WHERE user_email = ?`

</details>

<details><summary>SQL executed by GET /api/work-entries?clientId= (first iteration)</summary>

- 1ms `SELECT COUNT(*) AS total FROM work_entries we WHERE we.user_email = ? AND we.client_id = ?`
- 0ms `SELECT we.id, we.client_id, we.hours, we.description, we.date, we.created_at, we.updated_at, c.name as client_name FROM work_entries we JOIN clients c ON we.client_id = c.id WHERE we.user_email = ? AND we.client_id = ? ORDER BY we.date DESC, we.created_at DESC LIMIT ? OFFSET ?`

</details>

<details><summary>SQL executed by GET /api/work-entries/:id (first iteration)</summary>

- 0ms `SELECT we.id, we.client_id, we.hours, we.description, we.date, we.created_at, we.updated_at, c.name as client_name FROM work_entries we JOIN clients c ON we.client_id = c.id WHERE we.id = ? AND we.user_email = ?`

</details>

<details><summary>SQL executed by POST /api/work-entries (first iteration)</summary>

- 1ms `SELECT id FROM clients WHERE id = ? AND user_email = ?`
- 0ms `INSERT INTO work_entries (client_id, user_email, hours, description, date) VALUES (?, ?, ?, ?, ?)`
- 0ms `SELECT we.id, we.client_id, we.hours, we.description, we.date, we.created_at, we.updated_at, c.name as client_name FROM work_entries we JOIN clients c ON we.client_id = c.id WHERE we.id = ?`

</details>

<details><summary>SQL executed by PUT /api/work-entries/:id (first iteration)</summary>

- 0ms `SELECT id FROM work_entries WHERE id = ? AND user_email = ?`
- 0ms `SELECT id FROM clients WHERE id = ? AND user_email = ?`
- 0ms `UPDATE work_entries SET client_id = ?, hours = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_email = ?`
- 1ms `SELECT we.id, we.client_id, we.hours, we.description, we.date, we.created_at, we.updated_at, c.name as client_name FROM work_entries we JOIN clients c ON we.client_id = c.id WHERE we.id = ?`

</details>

## Service: reports

| Endpoint | Status | p50 ms | p95 ms | max ms | SQL stmts/req | SQL ms/req | Payload bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| GET /api/reports/client/:id | 200 | 4.73 | 7.09 | 7.44 | 3.0 | 1.9 | 168122 |
| GET /api/reports/export/csv/:id | 200 | 4.92 | 8.13 | 8.13 | 2.0 | 2.1 | 70942 |
| GET /api/reports/export/pdf/:id | 200 | 46.70 | 94.06 | 94.06 | 3.0 | 5.4 | 99453 |

<details><summary>SQL executed by GET /api/reports/client/:id (first iteration)</summary>

- 0ms `SELECT id, name FROM clients WHERE id = ? AND user_email = ?`
- 0ms `SELECT COUNT(*) AS entryCount, COALESCE(SUM(hours), 0) AS totalHours FROM work_entries WHERE client_id = ? AND user_email = ?`
- 2ms `SELECT id, hours, description, date, created_at, updated_at FROM work_entries WHERE client_id = ? AND user_email = ? ORDER BY date DESC`

</details>

<details><summary>SQL executed by GET /api/reports/export/csv/:id (first iteration)</summary>

- 0ms `SELECT id, name FROM clients WHERE id = ? AND user_email = ?`
- 2ms `SELECT hours, description, date, created_at FROM work_entries WHERE client_id = ? AND user_email = ? ORDER BY date DESC`

</details>

<details><summary>SQL executed by GET /api/reports/export/pdf/:id (first iteration)</summary>

- 1ms `SELECT id, name FROM clients WHERE id = ? AND user_email = ?`
- 17ms `SELECT COUNT(*) AS entryCount, COALESCE(SUM(hours), 0) AS totalHours FROM work_entries WHERE client_id = ? AND user_email = ?`
- 1ms `SELECT hours, description, date, created_at FROM work_entries WHERE client_id = ? AND user_email = ? ORDER BY date DESC`

</details>

## EXPLAIN QUERY PLAN

### work-entries list (GET /api/work-entries)

```sql
SELECT we.id, we.client_id, we.hours, we.description, we.date,
we.created_at, we.updated_at, c.name as client_name
FROM work_entries we
JOIN clients c ON we.client_id = c.id
WHERE we.user_email = ?
ORDER BY we.date DESC, we.created_at DESC
LIMIT ? OFFSET ?
```

- SEARCH we USING INDEX idx_work_entries_user_date_created (user_email=?)
- SEARCH c USING INTEGER PRIMARY KEY (rowid=?)

### work-entries list count (GET /api/work-entries total)

```sql
SELECT COUNT(*) AS total FROM work_entries we WHERE we.user_email = ?
```

- SEARCH we USING COVERING INDEX idx_work_entries_user_email (user_email=?)

### work-entries list filtered (GET /api/work-entries?clientId=)

```sql
SELECT we.id, we.client_id, we.hours, we.description, we.date,
we.created_at, we.updated_at, c.name as client_name
FROM work_entries we
JOIN clients c ON we.client_id = c.id
WHERE we.user_email = ? AND we.client_id = ?
ORDER BY we.date DESC, we.created_at DESC
```

- SEARCH c USING INTEGER PRIMARY KEY (rowid=?)
- SEARCH we USING INDEX idx_work_entries_user_client_date (user_email=? AND client_id=?)
- USE TEMP B-TREE FOR RIGHT PART OF ORDER BY

### client report rows (GET /api/reports/client/:id, csv, pdf)

```sql
SELECT id, hours, description, date, created_at, updated_at
FROM work_entries
WHERE client_id = ? AND user_email = ?
ORDER BY date DESC
```

- SEARCH work_entries USING INDEX idx_work_entries_user_client_date (user_email=? AND client_id=?)

### client report aggregate (SUM/COUNT)

```sql
SELECT COUNT(*) AS entryCount, COALESCE(SUM(hours), 0) AS totalHours
FROM work_entries
WHERE client_id = ? AND user_email = ?
```

- SEARCH work_entries USING INDEX idx_work_entries_user_client_date (user_email=? AND client_id=?)

### user summary aggregate (SUM/COUNT by user_email)

```sql
SELECT COUNT(*) AS entryCount, COALESCE(SUM(hours), 0) AS totalHours
FROM work_entries
WHERE user_email = ?
```

- SEARCH work_entries USING INDEX idx_work_entries_user_email (user_email=?)

### auth user lookup

```sql
SELECT email FROM users WHERE email = ?
```

- SEARCH users USING COVERING INDEX sqlite_autoindex_users_1 (email=?)

## Indexes present

- `CREATE INDEX idx_clients_user_email ON clients (user_email)`
- `CREATE INDEX idx_work_entries_client_id ON work_entries (client_id)`
- `CREATE INDEX idx_work_entries_date ON work_entries (date)`
- `CREATE INDEX idx_work_entries_user_client_date ON work_entries (user_email, client_id, date)`
- `CREATE INDEX idx_work_entries_user_date_created ON work_entries (user_email, date, created_at)`
- `CREATE INDEX idx_work_entries_user_email ON work_entries (user_email)`
