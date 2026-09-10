# Performance audit

- Generated: 2026-09-10T08:01:57.300Z
- Node v24.19.0, in-memory SQLite
- Dataset: 5 user, 50 clients, 50000 work entries (seeded in 1462ms)
- Default iterations per endpoint: 30 (heavy endpoints: 10)

## Service: auth

| Endpoint | Status | p50 ms | p95 ms | max ms | SQL stmts/req | SQL ms/req | Payload bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| POST /api/auth/login (existing user) | 200 | 1.16 | 2.30 | 17.53 | 1.0 | 0.3 | 100 |
| GET /api/auth/me | 200 | 1.28 | 1.44 | 1.84 | 2.0 | 0.2 | 71 |
| authenticateUser (via GET /api/clients/:id) | 200 | 1.13 | 2.28 | 2.91 | 2.0 | 0.2 | 196 |

<details><summary>SQL executed by POST /api/auth/login (existing user) (first iteration)</summary>

- 3ms `SELECT email, created_at FROM users WHERE email = ?`

</details>

<details><summary>SQL executed by GET /api/auth/me (first iteration)</summary>

- 0ms `SELECT email FROM users WHERE email = ?`
- 0ms `SELECT email, created_at FROM users WHERE email = ?`

</details>

<details><summary>SQL executed by authenticateUser (via GET /api/clients/:id) (first iteration)</summary>

- 0ms `SELECT email FROM users WHERE email = ?`
- 0ms `SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE id = ? AND user_email = ?`

</details>

## Service: clients

| Endpoint | Status | p50 ms | p95 ms | max ms | SQL stmts/req | SQL ms/req | Payload bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| GET /api/clients | 200 | 1.40 | 1.62 | 1.66 | 2.0 | 0.2 | 9350 |
| GET /api/clients/:id | 200 | 1.10 | 1.23 | 1.33 | 2.0 | 0.3 | 196 |

<details><summary>SQL executed by GET /api/clients (first iteration)</summary>

- 0ms `SELECT email FROM users WHERE email = ?`
- 0ms `SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE user_email = ? ORDER BY name`

</details>

<details><summary>SQL executed by GET /api/clients/:id (first iteration)</summary>

- 0ms `SELECT email FROM users WHERE email = ?`
- 0ms `SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE id = ? AND user_email = ?`

</details>

## Service: work-entries

| Endpoint | Status | p50 ms | p95 ms | max ms | SQL stmts/req | SQL ms/req | Payload bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| GET /api/work-entries | 200 | 199.07 | 222.10 | 222.10 | 2.0 | 79.6 | 10346319 |
| GET /api/work-entries?clientId= | 200 | 4.84 | 7.52 | 9.32 | 2.0 | 1.8 | 204267 |
| GET /api/work-entries/:id | 200 | 1.06 | 1.34 | 1.36 | 2.0 | 0.3 | 207 |
| POST /api/work-entries | 201 | 1.57 | 1.88 | 3.16 | 4.0 | 0.7 | 236 |
| PUT /api/work-entries/:id | 200 | 1.48 | 2.32 | 3.74 | 5.0 | 0.5 | 247 |

<details><summary>SQL executed by GET /api/work-entries (first iteration)</summary>

- 0ms `SELECT email FROM users WHERE email = ?`
- 87ms `SELECT we.id, we.client_id, we.hours, we.description, we.date, we.created_at, we.updated_at, c.name as client_name FROM work_entries we JOIN clients c ON we.client_id = c.id WHERE we.user_email = ? ORDER BY we.date DESC, we.created_at DESC`

</details>

<details><summary>SQL executed by GET /api/work-entries?clientId= (first iteration)</summary>

- 1ms `SELECT email FROM users WHERE email = ?`
- 1ms `SELECT we.id, we.client_id, we.hours, we.description, we.date, we.created_at, we.updated_at, c.name as client_name FROM work_entries we JOIN clients c ON we.client_id = c.id WHERE we.user_email = ? AND we.client_id = ? ORDER BY we.date DESC, we.created_at DESC`

</details>

<details><summary>SQL executed by GET /api/work-entries/:id (first iteration)</summary>

- 0ms `SELECT email FROM users WHERE email = ?`
- 0ms `SELECT we.id, we.client_id, we.hours, we.description, we.date, we.created_at, we.updated_at, c.name as client_name FROM work_entries we JOIN clients c ON we.client_id = c.id WHERE we.id = ? AND we.user_email = ?`

</details>

<details><summary>SQL executed by POST /api/work-entries (first iteration)</summary>

- 1ms `SELECT email FROM users WHERE email = ?`
- 0ms `SELECT id FROM clients WHERE id = ? AND user_email = ?`
- 0ms `INSERT INTO work_entries (client_id, user_email, hours, description, date) VALUES (?, ?, ?, ?, ?)`
- 0ms `SELECT we.id, we.client_id, we.hours, we.description, we.date, we.created_at, we.updated_at, c.name as client_name FROM work_entries we JOIN clients c ON we.client_id = c.id WHERE we.id = ?`

</details>

<details><summary>SQL executed by PUT /api/work-entries/:id (first iteration)</summary>

- 0ms `SELECT email FROM users WHERE email = ?`
- 1ms `SELECT id FROM work_entries WHERE id = ? AND user_email = ?`
- 0ms `SELECT id FROM clients WHERE id = ? AND user_email = ?`
- 0ms `UPDATE work_entries SET client_id = ?, hours = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_email = ?`
- 0ms `SELECT we.id, we.client_id, we.hours, we.description, we.date, we.created_at, we.updated_at, c.name as client_name FROM work_entries we JOIN clients c ON we.client_id = c.id WHERE we.id = ?`

</details>

## Service: reports

| Endpoint | Status | p50 ms | p95 ms | max ms | SQL stmts/req | SQL ms/req | Payload bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| GET /api/reports/client/:id | 200 | 4.37 | 7.37 | 7.43 | 3.0 | 1.6 | 168122 |
| GET /api/reports/export/csv/:id | 200 | 4.21 | 9.72 | 9.72 | 3.0 | 1.4 | 70942 |
| GET /api/reports/export/pdf/:id | 200 | 50.21 | 87.33 | 87.33 | 3.0 | 1.5 | 99237 |

<details><summary>SQL executed by GET /api/reports/client/:id (first iteration)</summary>

- 0ms `SELECT email FROM users WHERE email = ?`
- 0ms `SELECT id, name FROM clients WHERE id = ? AND user_email = ?`
- 2ms `SELECT id, hours, description, date, created_at, updated_at FROM work_entries WHERE client_id = ? AND user_email = ? ORDER BY date DESC`

</details>

<details><summary>SQL executed by GET /api/reports/export/csv/:id (first iteration)</summary>

- 0ms `SELECT email FROM users WHERE email = ?`
- 0ms `SELECT id, name FROM clients WHERE id = ? AND user_email = ?`
- 2ms `SELECT hours, description, date, created_at FROM work_entries WHERE client_id = ? AND user_email = ? ORDER BY date DESC`

</details>

<details><summary>SQL executed by GET /api/reports/export/pdf/:id (first iteration)</summary>

- 0ms `SELECT email FROM users WHERE email = ?`
- 0ms `SELECT id, name FROM clients WHERE id = ? AND user_email = ?`
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
```

- SEARCH we USING INDEX idx_work_entries_user_email (user_email=?)
- SEARCH c USING INTEGER PRIMARY KEY (rowid=?)
- USE TEMP B-TREE FOR ORDER BY

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
- SEARCH we USING INDEX idx_work_entries_client_id (client_id=?)
- USE TEMP B-TREE FOR ORDER BY

### client report rows (GET /api/reports/client/:id, csv, pdf)

```sql
SELECT id, hours, description, date, created_at, updated_at
FROM work_entries
WHERE client_id = ? AND user_email = ?
ORDER BY date DESC
```

- SEARCH work_entries USING INDEX idx_work_entries_client_id (client_id=?)
- USE TEMP B-TREE FOR ORDER BY

### client report aggregate (SUM/COUNT)

```sql
SELECT COUNT(*) AS entryCount, COALESCE(SUM(hours), 0) AS totalHours
FROM work_entries
WHERE client_id = ? AND user_email = ?
```

- SEARCH work_entries USING INDEX idx_work_entries_client_id (client_id=?)

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
- `CREATE INDEX idx_work_entries_user_email ON work_entries (user_email)`
