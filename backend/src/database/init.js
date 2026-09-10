/**
 * @fileoverview SQLite connection lifecycle for the backend.
 *
 * The connection is a single module-level singleton opened against the special
 * `:memory:` filename. Consequences that every consumer must keep in mind:
 * - All data (users, clients, work entries) lives only in the process heap and
 *   is lost when the process exits or when `closeDatabase()` is called.
 * - There is no file on disk and no `DATABASE_URL`; config/production.js is not
 *   consulted by this module (or by anything else at runtime).
 * - Tests get a clean slate simply by closing and re-opening the connection.
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/** @type {sqlite3.Database|null} Lazily-created singleton connection. */
let db = null;
/** @type {boolean} True while `db.close()` is in flight. */
let isClosing = false;
/** @type {boolean} True after a close has completed and before the next open. */
let isClosed = false;

/**
 * Returns the shared SQLite connection, opening it on first use.
 *
 * @description
 * Opens `new sqlite3.Database(':memory:')` the first time it is called (or the
 * first time after `closeDatabase()` has nulled the singleton) and resets the
 * `isClosing` / `isClosed` flags so the state machine starts fresh for the new
 * connection. Subsequent calls return the same instance.
 *
 * `:memory:` is used intentionally (per the original project requirements) so
 * the app needs no filesystem or external database; the trade-off is that data
 * does not survive a restart.
 *
 * Note that this only opens the connection; it does NOT create tables. Call
 * `initializeDatabase()` before issuing queries against a fresh connection.
 *
 * @returns {sqlite3.Database} The open (or newly opened) connection.
 * @throws {Error} Re-throws the sqlite3 open error from inside the open callback
 *   if the in-memory database cannot be created.
 */
function getDatabase() {
  if (!db) {
    // Reset state when creating a new database connection
    isClosing = false;
    isClosed = false;
    // Use in-memory database as specified in requirements
    db = new sqlite3.Database(':memory:', (err) => {
      if (err) {
        console.error('Error opening database:', err);
        throw err;
      }
      console.log('Connected to SQLite in-memory database');
    });
  }
  return db;
}

/**
 * Creates the schema (tables + indexes) on the current connection.
 *
 * @description
 * Runs, inside `database.serialize()` so statements execute in order:
 * - `users(email PK, created_at)`
 * - `clients(id PK AUTOINCREMENT, name, description, department, email,
 *   user_email FK->users ON DELETE CASCADE, created_at, updated_at)`
 * - `work_entries(id PK AUTOINCREMENT, client_id FK->clients ON DELETE CASCADE,
 *   user_email FK->users ON DELETE CASCADE, hours DECIMAL(5,2), description,
 *   date, created_at, updated_at)`
 * - indexes on `clients.user_email`, `work_entries.client_id`,
 *   `work_entries.user_email`, `work_entries.date`.
 *
 * All statements use `IF NOT EXISTS`, so calling this repeatedly on the same
 * connection is a no-op. Because the database is in-memory, this must run once
 * per process start (server.js does so) and once per fresh connection in tests.
 *
 * The returned promise resolves after the statements have been queued in the
 * serialized block; individual `run()` errors are not surfaced (no callbacks are
 * attached), so `reject` is never called.
 *
 * @returns {Promise<void>} Resolves once the schema statements have been issued.
 */
async function initializeDatabase() {
  const database = getDatabase();
  
  return new Promise((resolve, reject) => {
    database.serialize(() => {
      // Create users table
      database.run(`
        CREATE TABLE IF NOT EXISTS users (
          email TEXT PRIMARY KEY,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create clients table
      database.run(`
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

      // Create work_entries table
      database.run(`
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

      // Create indexes for better performance
      database.run(`CREATE INDEX IF NOT EXISTS idx_clients_user_email ON clients (user_email)`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_work_entries_client_id ON work_entries (client_id)`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_work_entries_user_email ON work_entries (user_email)`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_work_entries_date ON work_entries (date)`);

      console.log('Database tables created successfully');
      resolve();
    });
  });
}

/**
 * Closes the shared connection, discarding all in-memory data.
 *
 * @description
 * Primarily a test-support hook: Jest suites call this in `afterAll`/`afterEach`
 * so each suite (or test) starts from an empty database and no sqlite handles
 * keep the process alive. server.js itself never calls it; the production
 * connection simply dies with the process.
 *
 * Because several test files (and their setup helpers) can call this
 * concurrently, it implements a small state machine over `db`, `isClosing`, and
 * `isClosed`:
 *
 *   (no db)            -> resolve immediately
 *   isClosed === true  -> resolve immediately (idempotent double-close)
 *   isClosing === true -> another caller already issued `db.close()`; poll
 *                         `isClosed` every 10 ms and resolve when it flips
 *   otherwise          -> set isClosing, call `db.close()`, and in its callback
 *                         set isClosed = true, isClosing = false, db = null
 *
 * Why poll instead of awaiting a shared promise: sqlite3's `close()` is
 * callback-based and only the first caller owns that callback. Polling a flag
 * lets any number of concurrent callers wait for the same close to finish
 * without ever calling `close()` twice on the same handle (which sqlite3
 * rejects with SQLITE_MISUSE).
 *
 * Close errors are logged but swallowed; the promise always resolves so
 * teardown never fails a test run. The next `getDatabase()` call after a close
 * transparently opens a brand-new, empty in-memory database.
 *
 * @returns {Promise<void>} Resolves once the connection is closed (or was
 *   already closed / never opened).
 */
function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (isClosed) {
      // Already closed, resolve immediately
      resolve();
      return;
    }
    
    if (isClosing) {
      // Currently closing, wait for it to complete
      const checkClosed = setInterval(() => {
        if (isClosed) {
          clearInterval(checkClosed);
          resolve();
        }
      }, 10);
      return;
    }
    
    if (!db) {
      // No database connection, resolve immediately
      resolve();
      return;
    }
    
    isClosing = true;
    db.close((err) => {
      isClosed = true;
      isClosing = false;
      db = null;
      if (err) {
        console.error('Error closing database:', err);
      } else {
        console.log('Database connection closed');
      }
      resolve();
    });
  });
}

module.exports = {
  getDatabase,
  initializeDatabase,
  closeDatabase
};
