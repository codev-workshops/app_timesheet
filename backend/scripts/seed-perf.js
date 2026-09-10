/**
 * Seeds a realistic profiling dataset into the (in-memory) SQLite database.
 *
 * Because the app uses an in-memory database, this must run inside the same
 * process as the server. It is used by:
 *   - scripts/perf-audit.js (programmatically)
 *   - src/server.js when PERF_SEED=1 (seeds on boot so the dev server has data)
 *
 * Usage (standalone, prints row counts and exits):
 *   node scripts/seed-perf.js
 */
const { getDatabase, initializeDatabase, closeDatabase } = require('../src/database/init');

const DEFAULTS = {
  userEmail: 'perf@example.com',
  clientCount: 50,
  entryCount: 50000,
  // Additional tenants so user_email is selective in the planner statistics.
  otherUserCount: 4,
  otherUserEntryCount: 2500,
  seed: 42
};

// Deterministic PRNG so every run produces the same dataset.
function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DESCRIPTIONS = [
  'Sprint planning and backlog grooming',
  'Implemented API endpoint, "quoted" text',
  'Code review, pairing, and mentoring',
  'Bug fix: report totals off by one\nfollow-up in next sprint',
  'Client meeting and requirements capture',
  'Refactored database access layer',
  'Wrote integration tests',
  null
];

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function seedPerfData(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const db = getDatabase();
  const rng = createRng(opts.seed);

  await run(db, 'INSERT OR IGNORE INTO users (email) VALUES (?)', [opts.userEmail]);

  const clientIds = [];
  for (let i = 0; i < opts.clientCount; i++) {
    const result = await run(
      db,
      'INSERT INTO clients (name, description, department, email, user_email) VALUES (?, ?, ?, ?, ?)',
      [
        `Client ${String(i + 1).padStart(3, '0')}`,
        `Perf client ${i + 1}`,
        ['Engineering', 'Marketing', 'Finance', 'Operations'][i % 4],
        `client${i + 1}@example.com`,
        opts.userEmail
      ]
    );
    clientIds.push(result.lastID);
  }

  // Spread entries over the last ~3 years. Batch inside a transaction with a
  // prepared statement so seeding 50k rows takes well under a second.
  const start = new Date('2023-01-01T00:00:00Z').getTime();
  const span = new Date('2025-12-31T00:00:00Z').getTime() - start;

  const insertEntries = (email, ids, count) =>
    new Promise((resolve, reject) => {
      const stmt = db.prepare(
        'INSERT INTO work_entries (client_id, user_email, hours, description, date) VALUES (?, ?, ?, ?, ?)'
      );
      for (let i = 0; i < count; i++) {
        const clientId = ids[Math.floor(rng() * ids.length)];
        const hours = Math.round((0.25 + rng() * 7.75) * 4) / 4;
        const description = DESCRIPTIONS[Math.floor(rng() * DESCRIPTIONS.length)];
        const date = formatDate(new Date(start + Math.floor(rng() * span)));
        stmt.run([clientId, email, hours, description, date]);
      }
      stmt.finalize((err) => (err ? reject(err) : resolve()));
    });

  await run(db, 'BEGIN TRANSACTION');
  await insertEntries(opts.userEmail, clientIds, opts.entryCount);

  for (let u = 0; u < opts.otherUserCount; u++) {
    const email = `tenant${u + 1}@example.com`;
    await run(db, 'INSERT OR IGNORE INTO users (email) VALUES (?)', [email]);
    const ids = [];
    for (let c = 0; c < 5; c++) {
      const result = await run(
        db,
        'INSERT INTO clients (name, user_email) VALUES (?, ?)',
        [`Tenant ${u + 1} Client ${c + 1}`, email]
      );
      ids.push(result.lastID);
    }
    await insertEntries(email, ids, opts.otherUserEntryCount);
  }
  await run(db, 'COMMIT');

  // Refresh planner statistics so EXPLAIN QUERY PLAN reflects the real data.
  await run(db, 'ANALYZE');

  const counts = {
    users: (await get(db, 'SELECT COUNT(*) AS n FROM users')).n,
    clients: (await get(db, 'SELECT COUNT(*) AS n FROM clients WHERE user_email = ?', [opts.userEmail])).n,
    workEntries: (await get(db, 'SELECT COUNT(*) AS n FROM work_entries WHERE user_email = ?', [opts.userEmail])).n
  };

  return { userEmail: opts.userEmail, clientIds, counts };
}

if (require.main === module) {
  (async () => {
    await initializeDatabase();
    const started = process.hrtime.bigint();
    const result = await seedPerfData();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`Seeded ${JSON.stringify(result.counts)} in ${ms.toFixed(0)}ms`);
    await closeDatabase();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedPerfData, DEFAULTS };
