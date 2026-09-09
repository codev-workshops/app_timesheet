const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Module-level singleton plus a hand-rolled close state machine. `sqlite3`
// gives no way to ask a handle whether it is closed, and `closeDatabase()` can
// be called concurrently (Jest teardown in several suites, plus process exit),
// so the lifecycle is tracked here instead.
let db = null;
let isClosing = false;
let isClosed = false;

/**
 * Returns the process-wide SQLite handle, opening it on first use.
 *
 * The database is `:memory:`, so the handle is effectively the dataset: every
 * caller must share this one instance or they would each get an empty, private
 * database. That also means restarting the server (or closing the handle in a
 * test) discards all data by design.
 *
 * Re-opening after a close resets the close flags, which is what lets a test
 * suite tear down and rebuild a clean database within the same process.
 *
 * @returns {import('sqlite3').Database} The shared in-memory connection.
 * @throws {Error} If SQLite fails to open the connection.
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
 * Creates the schema and indexes on the shared connection.
 *
 * Wrapped in `serialize()` so the statements run in order — the `clients` and
 * `work_entries` foreign keys reference tables created earlier in the same
 * batch. Every statement is `IF NOT EXISTS`, so it is safe to call repeatedly
 * (the server calls it at boot, tests call it per suite).
 *
 * Note the `ON DELETE CASCADE` foreign keys: they express the intended
 * ownership graph (deleting a client should remove its work entries), but
 * SQLite only enforces foreign keys when `PRAGMA foreign_keys = ON` is set, and
 * this app never sets it. Cascades therefore do NOT fire at runtime, which is
 * why handlers such as the work-entry PUT verify client ownership themselves
 * rather than relying on the database.
 *
 * The resolve happens from inside `serialize()` once the statements have been
 * queued, so it signals "schema work submitted", not "schema committed";
 * subsequent queries on the same serialized connection still observe the
 * tables.
 *
 * @returns {Promise<void>} Resolves once the DDL statements have been queued.
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
 * Closes the shared connection, tolerating repeat and concurrent calls.
 *
 * Exists mainly for test teardown: Jest suites close the database in
 * `afterAll`, and an unclosed handle keeps the process alive. Because several
 * suites may race, this resolves immediately when already closed and otherwise
 * waits for an in-flight close.
 *
 * The wait is a 10ms poll on `isClosed` rather than a queue of pending
 * promises: `sqlite3.close()` only notifies its own callback, so a second
 * caller has no event to await and polling the flag is the simplest way to
 * join. A failed close still marks the handle closed and drops the reference —
 * the next `getDatabase()` then opens a fresh (empty) database instead of
 * handing back a dead handle. Errors are logged, never rejected, so teardown
 * cannot fail the suite.
 *
 * @returns {Promise<void>} Resolves when the connection is closed (or was already).
 */
function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (isClosed) {
      // Already closed, resolve immediately
      resolve();
      return;
    }
    
    if (isClosing) {
      // Join the in-flight close by polling the flag; sqlite3 offers no way to
      // register a second close listener.
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
