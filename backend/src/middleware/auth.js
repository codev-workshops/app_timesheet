const { getDatabase } = require('../database/init');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Emails already confirmed to exist in the users table. Bounded so a flood
// of distinct emails cannot grow memory without limit.
const MAX_KNOWN_USERS = 10000;
const knownUsers = new Set();

function rememberUser(email) {
  if (knownUsers.size >= MAX_KNOWN_USERS) {
    knownUsers.delete(knownUsers.values().next().value);
  }
  knownUsers.add(email);
}

function clearKnownUsers() {
  knownUsers.clear();
}

// Simple email-based authentication middleware. Creates the user on first
// sight with a single idempotent UPSERT; repeat requests skip the DB entirely.
function authenticateUser(req, res, next) {
  const userEmail = req.headers['x-user-email'];

  if (!userEmail) {
    return res.status(401).json({ error: 'User email required in x-user-email header' });
  }

  if (!EMAIL_REGEX.test(userEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (knownUsers.has(userEmail)) {
    req.userEmail = userEmail;
    return next();
  }

  const db = getDatabase();

  db.run(
    'INSERT INTO users (email) VALUES (?) ON CONFLICT(email) DO NOTHING',
    [userEmail],
    (err) => {
      if (err) {
        console.error('Error creating user:', err);
        return res.status(500).json({ error: 'Failed to create user' });
      }

      rememberUser(userEmail);
      req.userEmail = userEmail;
      next();
    }
  );
}

module.exports = {
  authenticateUser,
  clearKnownUsers
};
