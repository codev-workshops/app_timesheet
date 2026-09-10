/**
 * @fileoverview Trust-based identity middleware.
 *
 * There is no JWT, session, or password verification anywhere in this backend
 * (the `jsonwebtoken` package is declared in package.json but never required).
 * Identity is taken verbatim from the `x-user-email` request header; the caller
 * is trusted to send an honest value. Every downstream query is scoped by the
 * resulting `req.userEmail`, so this header is the sole tenancy boundary.
 */
const { getDatabase } = require('../database/init');

/**
 * Express middleware that establishes the current user from the `x-user-email`
 * header and exposes it as `req.userEmail` for route handlers.
 *
 * @description
 * Flow:
 * 1. Reject with 401 if the header is missing.
 * 2. Reject with 400 if the header is not shaped like an email
 *    (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`). Only the shape is checked; the address is
 *    never verified or authenticated.
 * 3. Look the email up in `users`. If no row exists, INSERT one and continue.
 * 4. Set `req.userEmail` and call `next()`.
 *
 * Why users are auto-provisioned here: the database is in-memory
 * (`:memory:`, see database/init.js) and is wiped on every process restart, and
 * there is no registration flow. Creating the `users` row lazily on the first
 * authenticated request keeps the `clients.user_email` / `work_entries.user_email`
 * foreign keys satisfiable without requiring callers to hit `POST /api/auth/login`
 * first. Any syntactically valid email therefore becomes a valid, empty tenant.
 *
 * Rate limiting is not applied here; it is a single global `express-rate-limit`
 * limiter (100 requests per 15 minutes per IP) registered in server.js.
 *
 * @param {import('express').Request} req - Incoming request. On success
 *   `req.userEmail` is set to the raw header value.
 * @param {import('express').Response} res - Response used for early rejections.
 * @param {import('express').NextFunction} next - Invoked once identity is established.
 * @returns {void} Responds directly on failure:
 *   - 401 `{ error: 'User email required in x-user-email header' }` when the header is absent
 *   - 400 `{ error: 'Invalid email format' }` when the header fails the regex
 *   - 500 `{ error: 'Internal server error' }` when the lookup query fails
 *   - 500 `{ error: 'Failed to create user' }` when auto-provisioning fails
 */
function authenticateUser(req, res, next) {
  const userEmail = req.headers['x-user-email'];
  
  if (!userEmail) {
    return res.status(401).json({ error: 'User email required in x-user-email header' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(userEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const db = getDatabase();
  
  // Check if user exists, create if not
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
