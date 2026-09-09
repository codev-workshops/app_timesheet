const { getDatabase } = require('../database/init');

/**
 * Express middleware that identifies the caller from the `x-user-email` header.
 *
 * This app deliberately uses a trusted-header auth model rather than JWTs or
 * passwords: the header value IS the identity, so anything that can reach the
 * API can act as any user. That trade-off keeps the demo/workshop flow
 * frictionless, but it means the API must never be exposed outside a trusted
 * network. The email is also the primary key of `users` and the tenant
 * discriminator (`user_email`) on every other table, so resolving it here is
 * what makes the per-user isolation in the route handlers possible.
 *
 * Unknown emails are auto-provisioned instead of rejected, mirroring the login
 * endpoint: there is no separate sign-up step, so a first request from a new
 * address must not 401 or the client could never bootstrap itself.
 *
 * @param {import('express').Request} req Request whose `x-user-email` header carries the identity; `req.userEmail` is set on success.
 * @param {import('express').Response} res Used for the terminal 401/400/500 responses.
 * @param {import('express').NextFunction} next Called only once a user row is known to exist.
 * @returns {void} Responds 401 when the header is missing, 400 when it is not a
 *   plausible email, 500 on database failure; otherwise defers to `next()`.
 */
function authenticateUser(req, res, next) {
  const userEmail = req.headers['x-user-email'];
  
  if (!userEmail) {
    return res.status(401).json({ error: 'User email required in x-user-email header' });
  }

  // Cheap shape check only: the goal is to keep junk out of the users table
  // (which auto-inserts below), not to prove the address is deliverable.
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(userEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const db = getDatabase();
  
  // Auto-provision on first sight so callers never need an explicit sign-up.
  db.get('SELECT email FROM users WHERE email = ?', [userEmail], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    if (!row) {
      // Create new user
      db.run('INSERT INTO users (email) VALUES (?)', [userEmail], (err) => {
        if (err) {
          console.error('Error creating user:', err);
          return res.status(500).json({ error: 'Failed to create user' });
        }
        
        req.userEmail = userEmail;
        next();
      });
    } else {
      req.userEmail = userEmail;
      next();
    }
  });
}

module.exports = {
  authenticateUser
};
