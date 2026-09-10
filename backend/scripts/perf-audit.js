/**
 * Performance audit: boots the API in-process against the seeded dataset and
 * measures every endpoint service-by-service.
 *
 *   npm run perf:audit                 # prints a markdown report to stdout
 *   npm run perf:audit -- --out docs/perf/baseline.md
 *   npm run perf:audit -- --entries 10000 --iterations 20
 *
 * For each endpoint it records wall-clock latency (p50/p95/max), the number
 * of SQL statements executed and their cumulative SQLite time (via the
 * sqlite3 'profile' event), and the response payload size. It also captures
 * EXPLAIN QUERY PLAN output for the hot list/report queries so index usage
 * can be compared before and after schema changes.
 *
 * The audit mounts the routers directly (no rate limiter) so it can issue
 * hundreds of requests; behaviour of the routes themselves is unchanged.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const { getDatabase, initializeDatabase, closeDatabase } = require('../src/database/init');
const { seedPerfData, DEFAULTS } = require('./seed-perf');
const { requestTimer } = require('../src/middleware/requestTimer');
const { errorHandler } = require('../src/middleware/errorHandler');

function parseArgs(argv) {
  const args = { out: null, entries: DEFAULTS.entryCount, clients: DEFAULTS.clientCount, iterations: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--entries') args.entries = parseInt(argv[++i], 10);
    else if (a === '--clients') args.clients = parseInt(argv[++i], 10);
    else if (a === '--iterations') args.iterations = parseInt(argv[++i], 10);
  }
  return args;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function fmt(n, digits = 2) {
  return Number(n).toFixed(digits);
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(requestTimer);
  app.use('/api/auth', require('../src/routes/auth'));
  app.use('/api/clients', require('../src/routes/clients'));
  app.use('/api/work-entries', require('../src/routes/workEntries'));
  app.use('/api/reports', require('../src/routes/reports'));
  app.use(errorHandler);
  return app;
}

// Collects sqlite3 'profile' events while a request is in flight.
function createSqlCollector(db) {
  let active = false;
  let statements = [];
  db.on('profile', (sql, ms) => {
    if (active) statements.push({ sql, ms });
  });
  return {
    start() {
      active = true;
      statements = [];
    },
    stop() {
      active = false;
      return statements;
    }
  };
}

function bufferParser(res, cb) {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function measure(app, collector, scenario, iterations) {
  const latencies = [];
  const queryCounts = [];
  const sqlTimes = [];
  const sizes = [];
  const statuses = new Set();
  let sampleStatements = null;

  const iters = scenario.iterations || iterations;
  for (let i = 0; i < iters; i++) {
    const req = scenario.build(app, i);
    collector.start();
    const start = process.hrtime.bigint();
    const res = await req.buffer(true).parse(bufferParser);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    const statements = collector.stop();

    latencies.push(elapsed);
    queryCounts.push(statements.length);
    sqlTimes.push(statements.reduce((s, q) => s + q.ms, 0));
    sizes.push(res.body.length);
    statuses.add(res.status);
    if (!sampleStatements) sampleStatements = statements;
  }

  latencies.sort((a, b) => a - b);
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1);

  return {
    service: scenario.service,
    name: scenario.name,
    iterations: iters,
    statuses: [...statuses].join(','),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: latencies[latencies.length - 1],
    queries: avg(queryCounts),
    sqlMs: avg(sqlTimes),
    bytes: avg(sizes),
    sampleStatements
  };
}

function explain(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.all(`EXPLAIN QUERY PLAN ${sql}`, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map((r) => r.detail));
    });
  });
}

function listIndexes(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT tbl_name, name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY tbl_name, name`,
      [],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

// Queries mirrored from the route handlers (kept in sync by hand so the
// plans reflect what the endpoints actually run).
const EXPLAIN_QUERIES = [
  {
    name: 'work-entries list (GET /api/work-entries)',
    sql: `SELECT we.id, we.client_id, we.hours, we.description, we.date,
                 we.created_at, we.updated_at, c.name as client_name
          FROM work_entries we
          JOIN clients c ON we.client_id = c.id
          WHERE we.user_email = ?
          ORDER BY we.date DESC, we.created_at DESC
          LIMIT ? OFFSET ?`,
    params: ['perf@example.com', 50, 0]
  },
  {
    name: 'work-entries list count (GET /api/work-entries total)',
    sql: `SELECT COUNT(*) AS total FROM work_entries we WHERE we.user_email = ?`,
    params: ['perf@example.com']
  },
  {
    name: 'work-entries list filtered (GET /api/work-entries?clientId=)',
    sql: `SELECT we.id, we.client_id, we.hours, we.description, we.date,
                 we.created_at, we.updated_at, c.name as client_name
          FROM work_entries we
          JOIN clients c ON we.client_id = c.id
          WHERE we.user_email = ? AND we.client_id = ?
          ORDER BY we.date DESC, we.created_at DESC`,
    params: ['perf@example.com', 1]
  },
  {
    name: 'client report rows (GET /api/reports/client/:id, csv, pdf)',
    sql: `SELECT id, hours, description, date, created_at, updated_at
          FROM work_entries
          WHERE client_id = ? AND user_email = ?
          ORDER BY date DESC`,
    params: [1, 'perf@example.com']
  },
  {
    name: 'client report aggregate (SUM/COUNT)',
    sql: `SELECT COUNT(*) AS entryCount, COALESCE(SUM(hours), 0) AS totalHours
          FROM work_entries
          WHERE client_id = ? AND user_email = ?`,
    params: [1, 'perf@example.com']
  },
  {
    name: 'user summary aggregate (SUM/COUNT by user_email)',
    sql: `SELECT COUNT(*) AS entryCount, COALESCE(SUM(hours), 0) AS totalHours
          FROM work_entries
          WHERE user_email = ?`,
    params: ['perf@example.com']
  },
  {
    name: 'auth user lookup',
    sql: `SELECT email FROM users WHERE email = ?`,
    params: ['perf@example.com']
  }
];

function buildScenarios(ctx) {
  const email = ctx.userEmail;
  const auth = (r) => r.set('x-user-email', email);
  const clientId = ctx.clientIds[0];
  const otherClientId = ctx.clientIds[1];

  return [
    // auth
    { service: 'auth', name: 'POST /api/auth/login (existing user)', build: (app) => request(app).post('/api/auth/login').send({ email }) },
    { service: 'auth', name: 'GET /api/auth/me', build: (app) => auth(request(app).get('/api/auth/me')) },
    { service: 'auth', name: 'authenticateUser (via GET /api/clients/:id)', build: (app) => auth(request(app).get(`/api/clients/${clientId}`)) },
    // clients
    { service: 'clients', name: 'GET /api/clients', build: (app) => auth(request(app).get('/api/clients')) },
    { service: 'clients', name: 'GET /api/clients/:id', build: (app) => auth(request(app).get(`/api/clients/${clientId}`)) },
    // work-entries
    { service: 'work-entries', name: 'GET /api/work-entries', iterations: 10, build: (app) => auth(request(app).get('/api/work-entries')) },
    { service: 'work-entries', name: 'GET /api/work-entries?limit=200', build: (app) => auth(request(app).get('/api/work-entries?limit=200')) },
    { service: 'work-entries', name: 'GET /api/work-entries/summary', build: (app) => auth(request(app).get('/api/work-entries/summary')) },
    { service: 'work-entries', name: 'GET /api/work-entries?clientId=', build: (app) => auth(request(app).get(`/api/work-entries?clientId=${clientId}`)) },
    { service: 'work-entries', name: 'GET /api/work-entries/:id', build: (app) => auth(request(app).get(`/api/work-entries/${ctx.workEntryId}`)) },
    {
      service: 'work-entries',
      name: 'POST /api/work-entries',
      build: (app) => auth(request(app).post('/api/work-entries')).send({ clientId, hours: 1.5, description: 'audit', date: '2025-06-01' })
    },
    {
      service: 'work-entries',
      name: 'PUT /api/work-entries/:id',
      build: (app, i) => auth(request(app).put(`/api/work-entries/${ctx.workEntryId}`)).send({ hours: 2 + (i % 3), clientId: i % 2 ? clientId : otherClientId })
    },
    // reports
    { service: 'reports', name: 'GET /api/reports/client/:id', build: (app) => auth(request(app).get(`/api/reports/client/${clientId}`)) },
    { service: 'reports', name: 'GET /api/reports/export/csv/:id', iterations: 10, build: (app) => auth(request(app).get(`/api/reports/export/csv/${clientId}`)) },
    { service: 'reports', name: 'GET /api/reports/export/pdf/:id', iterations: 10, build: (app) => auth(request(app).get(`/api/reports/export/pdf/${clientId}`)) }
  ];
}

function renderMarkdown({ args, counts, results, plans, indexes, seedMs }) {
  const lines = [];
  lines.push('# Performance audit');
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Node ${process.version}, in-memory SQLite`);
  lines.push(`- Dataset: ${counts.users} user, ${counts.clients} clients, ${counts.workEntries} work entries (seeded in ${fmt(seedMs, 0)}ms)`);
  lines.push(`- Default iterations per endpoint: ${args.iterations} (heavy endpoints: 10)`);
  lines.push('');

  const services = [...new Set(results.map((r) => r.service))];
  for (const service of services) {
    lines.push(`## Service: ${service}`);
    lines.push('');
    lines.push('| Endpoint | Status | p50 ms | p95 ms | max ms | SQL stmts/req | SQL ms/req | Payload bytes |');
    lines.push('|---|---|---:|---:|---:|---:|---:|---:|');
    for (const r of results.filter((x) => x.service === service)) {
      lines.push(
        `| ${r.name} | ${r.statuses} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.max)} | ${fmt(r.queries, 1)} | ${fmt(r.sqlMs, 1)} | ${fmt(r.bytes, 0)} |`
      );
    }
    lines.push('');
    for (const r of results.filter((x) => x.service === service)) {
      if (!r.sampleStatements || r.sampleStatements.length === 0) continue;
      lines.push(`<details><summary>SQL executed by ${r.name} (first iteration)</summary>`);
      lines.push('');
      for (const s of r.sampleStatements) {
        lines.push(`- ${s.ms}ms \`${s.sql.replace(/\s+/g, ' ').trim()}\``);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  lines.push('## EXPLAIN QUERY PLAN');
  lines.push('');
  for (const p of plans) {
    lines.push(`### ${p.name}`);
    lines.push('');
    lines.push('```sql');
    lines.push(p.sql.replace(/\n\s+/g, '\n').trim());
    lines.push('```');
    lines.push('');
    for (const d of p.plan) lines.push(`- ${d}`);
    lines.push('');
  }

  lines.push('## Indexes present');
  lines.push('');
  for (const idx of indexes) lines.push(`- \`${idx.sql}\``);
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  await initializeDatabase();
  const db = getDatabase();

  const seedStart = process.hrtime.bigint();
  const seeded = await seedPerfData({ entryCount: args.entries, clientCount: args.clients });
  const seedMs = Number(process.hrtime.bigint() - seedStart) / 1e6;
  console.error(`Seeded ${JSON.stringify(seeded.counts)} in ${fmt(seedMs, 0)}ms`);

  const workEntryId = await new Promise((resolve, reject) => {
    db.get('SELECT id FROM work_entries WHERE user_email = ? ORDER BY id LIMIT 1', [seeded.userEmail], (err, row) =>
      err ? reject(err) : resolve(row.id)
    );
  });

  const app = buildApp();
  const collector = createSqlCollector(db);
  const ctx = { ...seeded, workEntryId };

  const results = [];
  for (const scenario of buildScenarios(ctx)) {
    const r = await measure(app, collector, scenario, args.iterations);
    console.error(`${scenario.service.padEnd(13)} ${scenario.name.padEnd(48)} p50=${fmt(r.p50)}ms p95=${fmt(r.p95)}ms sql=${fmt(r.queries, 1)} status=${r.statuses}`);
    results.push(r);
  }

  const plans = [];
  for (const q of EXPLAIN_QUERIES) {
    plans.push({ ...q, plan: await explain(db, q.sql, q.params) });
  }
  const indexes = await listIndexes(db);

  const md = renderMarkdown({ args, counts: seeded.counts, results, plans, indexes, seedMs });
  if (args.out) {
    const outPath = path.resolve(process.cwd(), args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, md);
    console.error(`Wrote ${outPath}`);
  } else {
    console.log(md);
  }

  await closeDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
