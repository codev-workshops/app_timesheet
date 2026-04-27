import sqlite3 from 'sqlite3';

const verbose = sqlite3.verbose();

let db: sqlite3.Database | null = null;

function getDatabase(): sqlite3.Database {
  if (!db) {
    db = new verbose.Database(':memory:', (err) => {
      if (err) {
        console.error('Error opening database:', err);
        throw err;
      }
      console.log('Connected to SQLite in-memory database');
    });
  }
  return db;
}

function dbRun(sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    getDatabase().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    getDatabase().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

function dbAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    getDatabase().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

async function initializeDatabase(): Promise<void> {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      department TEXT,
      email TEXT,
      user_email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_email) REFERENCES users (email) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS work_entries (
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
    )
  `);

  await dbRun('CREATE INDEX IF NOT EXISTS idx_clients_user_email ON clients (user_email)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_work_entries_client_id ON work_entries (client_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_work_entries_user_email ON work_entries (user_email)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_work_entries_date ON work_entries (date)');

  console.log('Database tables created successfully');
}

function closeDatabase(): Promise<void> {
  return new Promise((resolve) => {
    if (!db) {
      resolve();
      return;
    }
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      }
      db = null;
      resolve();
    });
  });
}

export { getDatabase, dbRun, dbGet, dbAll, initializeDatabase, closeDatabase };
