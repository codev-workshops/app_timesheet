const sqlite3 = require('sqlite3').verbose();
const { migrateSchema, run, get, all } = require('../../database/migrate');

jest.unmock('sqlite3');

describe('migrateSchema', () => {
  let db;

  beforeEach(() => {
    return new Promise((resolve, reject) => {
      db = new sqlite3.Database(':memory:', (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });

  afterEach(() => {
    return new Promise((resolve, reject) => {
      db.close((err) => {
        db = null;
        if (err) return reject(err);
        resolve();
      });
    });
  });

  test('creates the new shared-clients schema on an empty database', async () => {
    await migrateSchema(db);

    const clientsColumns = (await all(db, `PRAGMA table_info(clients)`)).map(c => c.name);
    expect(clientsColumns).toEqual(['id', 'name', 'description', 'department', 'email', 'created_at', 'updated_at']);
    expect(clientsColumns).not.toContain('user_email');

    const workFks = await all(db, `PRAGMA foreign_key_list(work_entries)`);
    const clientFk = workFks.find(fk => fk.from === 'client_id');
    const userFk = workFks.find(fk => fk.from === 'user_email');
    expect(clientFk.on_delete).toBe('RESTRICT');
    expect(userFk.on_delete).toBe('CASCADE');
  });

  test('migrates a legacy schema that already has department and email columns', async () => {
    await run(db, `CREATE TABLE users (
      email TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(db, `CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      department TEXT,
      email TEXT,
      user_email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_email) REFERENCES users (email) ON DELETE CASCADE
    )`);
    await run(db, `CREATE TABLE work_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      hours DECIMAL(5,2) NOT NULL,
      description TEXT,
      date DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
      FOREIGN KEY (user_email) REFERENCES users (email) ON DELETE CASCADE
    )`);

    await run(db, `INSERT INTO users (email) VALUES ('alice@example.com')`);
    await run(db, `INSERT INTO clients (name, description, department, email, user_email) VALUES ('Client A', 'Desc', 'Eng', 'a@example.com', 'alice@example.com')`);
    const clientId = (await get(db, `SELECT id FROM clients`)).id;
    await run(db, `INSERT INTO work_entries (client_id, user_email, hours, date) VALUES (?, 'alice@example.com', 8, '2023-01-01')`, [clientId]);
    const workId = (await get(db, `SELECT id FROM work_entries`)).id;
    const { user_email: _creator, ...originalClient } = await get(db, 'SELECT * FROM clients');
    const originalWork = await get(db, 'SELECT * FROM work_entries');

    await migrateSchema(db);

    const migratedClient = await get(db, `SELECT * FROM clients`);
    expect(migratedClient).toEqual(originalClient);
    expect(await get(db, 'SELECT * FROM work_entries')).toEqual(originalWork);
    await migrateSchema(db);
    expect(await get(db, 'SELECT * FROM clients')).toEqual(originalClient);
    expect(await get(db, 'SELECT * FROM work_entries')).toEqual(originalWork);
    expect(migratedClient.name).toBe('Client A');
    expect(migratedClient.department).toBe('Eng');
    expect(migratedClient.email).toBe('a@example.com');
    expect(migratedClient.user_email).toBeUndefined();

    const migratedWork = await get(db, `SELECT * FROM work_entries`);
    expect(migratedWork.id).toBe(workId);
    expect(migratedWork.client_id).toBe(clientId);
    expect(migratedWork.user_email).toBe('alice@example.com');
    expect(await all(db, 'SELECT name, seq FROM sqlite_sequence WHERE name IN (?, ?) ORDER BY name', ['clients', 'work_entries']))
      .toEqual([{ name: 'clients', seq: clientId }, { name: 'work_entries', seq: workId }]);
    const nextClient = await run(db, 'INSERT INTO clients (name) VALUES (?)', ['Next Client']);
    expect(nextClient.lastID).toBe(clientId + 1);
    const nextEntry = await run(db, 'INSERT INTO work_entries (client_id, user_email, hours, date) VALUES (?, ?, ?, ?)',
      [nextClient.lastID, 'alice@example.com', 1, '2026-09-10']);
    expect(nextEntry.lastID).toBe(workId + 1);

    const workFks = await all(db, `PRAGMA foreign_key_list(work_entries)`);
    const clientFk = workFks.find(fk => fk.from === 'client_id');
    expect(clientFk.on_delete).toBe('RESTRICT');
  });

  test('migrates a legacy schema that is missing department and email columns', async () => {
    await run(db, `CREATE TABLE users (
      email TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(db, `CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      user_email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_email) REFERENCES users (email) ON DELETE CASCADE
    )`);
    await run(db, `CREATE TABLE work_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      hours DECIMAL(5,2) NOT NULL,
      description TEXT,
      date DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
      FOREIGN KEY (user_email) REFERENCES users (email) ON DELETE CASCADE
    )`);

    await run(db, `INSERT INTO users (email) VALUES ('bob@example.com')`);
    await run(db, `INSERT INTO clients (name, user_email) VALUES ('Client B', 'bob@example.com')`);
    const clientId = (await get(db, `SELECT id FROM clients`)).id;
    await run(db, `INSERT INTO work_entries (client_id, user_email, hours, date) VALUES (?, 'bob@example.com', 4, '2023-02-01')`, [clientId]);

    await migrateSchema(db);

    const migratedClient = await get(db, `SELECT * FROM clients`);
    expect(migratedClient.name).toBe('Client B');
    expect(migratedClient.department).toBeNull();
    expect(migratedClient.email).toBeNull();

    const work = await all(db, `SELECT * FROM work_entries`);
    expect(work).toHaveLength(1);
  });

  test('migrates when legacy clients exists but work_entries is absent', async () => {
    await run(db, `CREATE TABLE users (
      email TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(db, `CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      user_email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_email) REFERENCES users (email) ON DELETE CASCADE
    )`);

    await run(db, `INSERT INTO users (email) VALUES ('carol@example.com')`);
    await run(db, `INSERT INTO clients (name, user_email) VALUES ('Client C', 'carol@example.com')`);

    await migrateSchema(db);

    const clientsTable = await get(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_entries'`);
    expect(clientsTable).toBeDefined();

    const client = await get(db, `SELECT * FROM clients`);
    expect(client.name).toBe('Client C');
    expect(client.user_email).toBeUndefined();

    const workFks = await all(db, `PRAGMA foreign_key_list(work_entries)`);
    const clientFk = workFks.find(fk => fk.from === 'client_id');
    expect(clientFk.on_delete).toBe('RESTRICT');
  });

  test('is idempotent on an already current schema', async () => {
    await migrateSchema(db);
    const firstColumns = (await all(db, `PRAGMA table_info(clients)`)).map(c => c.name);

    await migrateSchema(db);
    const secondColumns = (await all(db, `PRAGMA table_info(clients)`)).map(c => c.name);

    expect(secondColumns).toEqual(firstColumns);
  });

  test('rolls back schema changes and restores foreign keys on failure', async () => {
    await run(db, `CREATE TABLE users (
      email TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(db, `CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(db, `CREATE TABLE work_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      hours DECIMAL(5,2) NOT NULL,
      date DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await run(db, `INSERT INTO users (email) VALUES ('dave@example.com')`);
    await run(db, `INSERT INTO clients (name, user_email) VALUES ('Client D', 'dave@example.com')`);
    await run(db, `INSERT INTO work_entries (client_id, user_email, hours, date) VALUES (999, 'dave@example.com', 1, '2023-03-01')`);

    await expect(migrateSchema(db)).rejects.toThrow('Foreign key violations detected during migration');

    const legacyClient = await get(db, `SELECT * FROM clients`);
    expect(legacyClient).toBeDefined();
    expect(legacyClient.user_email).toBe('dave@example.com');

    const legacyWork = await all(db, `SELECT * FROM work_entries`);
    expect(legacyWork).toHaveLength(1);

    const fkOn = await get(db, `PRAGMA foreign_keys`);
    expect(fkOn.foreign_keys).toBe(1);
  });

  test('repairs missing work-entry foreign keys even when clients are already shared', async () => {
    await migrateSchema(db);
    await run(db, 'ALTER TABLE work_entries RENAME TO prior_work_entries');
    await run(db, 'CREATE TABLE work_entries AS SELECT * FROM prior_work_entries');
    await run(db, 'DROP TABLE prior_work_entries');

    await migrateSchema(db);

    const keys = await all(db, 'PRAGMA foreign_key_list(work_entries)');
    expect(keys).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'client_id', table: 'clients', to: 'id', on_delete: 'RESTRICT' }),
      expect.objectContaining({ from: 'user_email', table: 'users', to: 'email', on_delete: 'CASCADE' })
    ]));
    await expect(run(db, 'INSERT INTO work_entries (client_id, user_email, hours, date) VALUES (?, ?, ?, ?)',
      [999, 'missing@example.com', 1, '2026-09-10'])).rejects.toThrow(/FOREIGN KEY/);
  });

  test('does not overwrite existing tables that conflict with migration staging names', async () => {
    await migrateSchema(db);
    await run(db, 'ALTER TABLE clients ADD COLUMN user_email TEXT');
    await run(db, 'CREATE TABLE clients_new (marker TEXT)');
    await run(db, 'INSERT INTO clients_new (marker) VALUES (?)', ['preserve me']);

    await expect(migrateSchema(db)).rejects.toThrow(/already exists/);

    expect(await all(db, 'SELECT marker FROM clients_new')).toEqual([{ marker: 'preserve me' }]);
    expect((await all(db, 'PRAGMA table_info(clients)')).map(column => column.name)).toContain('user_email');
    expect(await get(db, 'PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });

  test('preserves both sqlite_sequence high-water ids for deleted rows', async () => {
    await run(db, `CREATE TABLE users (
      email TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(db, `CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(db, `CREATE TABLE work_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      hours DECIMAL(5,2) NOT NULL,
      date DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await run(db, `INSERT INTO users (email) VALUES ('ellen@example.com')`);
    await run(db, `INSERT INTO clients (name, user_email) VALUES ('ToDeleteClient', 'ellen@example.com')`);
    const clientId = (await get(db, `SELECT id FROM clients`)).id;
    await run(db, `INSERT INTO work_entries (client_id, user_email, hours, date) VALUES (?, 'ellen@example.com', 1, '2023-04-01')`, [clientId]);
    const workId = (await get(db, `SELECT id FROM work_entries`)).id;
    await run(db, `DELETE FROM clients`);
    await run(db, `DELETE FROM work_entries`);
    await run(db, `UPDATE sqlite_sequence SET seq = ? WHERE name = 'clients'`, [clientId]);
    await run(db, `UPDATE sqlite_sequence SET seq = ? WHERE name = 'work_entries'`, [workId]);

    await migrateSchema(db);

    const newClient = await run(db, `INSERT INTO clients (name, department, email) VALUES ('New Client', 'Sales', 'new@example.com')`);
    expect(newClient.lastID).toBe(clientId + 1);

    const newWork = await run(db, `INSERT INTO work_entries (client_id, user_email, hours, date) VALUES (?, 'ellen@example.com', 2, '2023-04-02')`, [newClient.lastID]);
    expect(newWork.lastID).toBe(workId + 1);
  });
});
