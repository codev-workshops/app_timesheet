const express = require('express');
const { getDatabase } = require('../database/init');
const { emailSchema } = require('../validation/schemas');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/login — email-only login that doubles as sign-up.
 *
 * There is no password, no credential check and no token issued: this app
 * authenticates every subsequent request with a trusted `x-user-email` header
 * (see the auth middleware), so "logging in" only means asserting which email
 * the client will send. Older documentation described a JWT flow; that was
 * never implemented, and nothing here mints or verifies a token.
 *
 * Because sign-up and sign-in are the same action, the status code is the only
 * signal distinguishing them: 200 when the user row already existed, 201 when
 * this call created it. The frontend treats both as success and just stores
 * the email in `localStorage`.
 *
 * @param {import('express').Request} req Expects `{ email }` (validated by `emailSchema`).
 * @param {import('express').Response} res Receives `{ message, user: { email, createdAt } }`.
 * @param {import('express').NextFunction} next Receives Joi validation errors for the shared error handler.
 * @returns {void} 200 for an existing user, 201 for a newly created one, 400 on
 *   invalid email, 500 if the lookup or insert fails.
 */
router.post('/login', async (req, res, next) => {
  try {
    const { error, value } = emailSchema.validate(req.body);
    if (error) {
      return next(error);
    }

    const { email } = value;
    const db = getDatabase();

    // Check if user exists
    db.get('SELECT email, created_at FROM users WHERE email = ?', [email], (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (row) {
        // User exists
        return res.json({
          message: 'Login successful',
          user: {
            email: row.email,
            createdAt: row.created_at
          }
        });
      } else {
        // Create new user
        db.run('INSERT INTO users (email) VALUES (?)', [email], function(err) {
          if (err) {
            console.error('Error creating user:', err);
            return res.status(500).json({ error: 'Failed to create user' });
          }

          // `created_at` is a database default, so it is not read back here;
          // the returned timestamp is the server's own clock and may differ
          // from the stored value by a few milliseconds.
          res.status(201).json({
            message: 'User created and logged in successfully',
            user: {
              email: email,
              createdAt: new Date().toISOString()
            }
          });
        });
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/me — echoes the authenticated user's row.
 *
 * Used by the frontend on page load to decide whether a stored email is still
 * usable. The 404 branch is close to unreachable in practice, since the auth
 * middleware creates the user before this handler runs; it only triggers if the
 * row disappears between the two queries (e.g. the in-memory database was
 * reset by a restart mid-session).
 *
 * @param {import('express').Request} req Authenticated request carrying `req.userEmail`.
 * @param {import('express').Response} res Receives `{ user: { email, createdAt } }`.
 * @returns {void} 200 with the user, 404 if the row is gone, 500 on database error.
 */
router.get('/me', authenticateUser, (req, res) => {
  const db = getDatabase();
  
  db.get('SELECT email, created_at FROM users WHERE email = ?', [req.userEmail], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        email: row.email,
        createdAt: row.created_at
      }
    });
  });
});

module.exports = router;
