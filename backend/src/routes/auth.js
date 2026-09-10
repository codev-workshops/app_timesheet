/**
 * @fileoverview Auth routes, mounted at `/api/auth` in server.js.
 *
 * "Auth" here is nominal: no credentials are checked and no token is issued.
 * `POST /login` merely ensures a `users` row exists for the supplied email, and
 * clients are then expected to send that same email in the `x-user-email`
 * header on every subsequent request (see middleware/auth.js). Because the
 * middleware auto-provisions users too, calling `/login` first is optional.
 */
const express = require('express');
const { getDatabase } = require('../database/init');
const { emailSchema } = require('../validation/schemas');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

/**
 * `POST /api/auth/login` - idempotent "login" that upserts the user row.
 *
 * @description
 * Does not require the `x-user-email` header (it is the one route that is not
 * behind `authenticateUser`). Validates the body with `emailSchema`, then:
 * - if a `users` row for the email exists, responds 200 with the stored
 *   `created_at`;
 * - otherwise INSERTs the row and responds 201. `createdAt` in the 201 body is
 *   `new Date().toISOString()` computed in Node, not the DB default, so it can
 *   differ slightly in format from the value returned by later `GET /me` calls.
 *
 * No password, token, cookie, or session is involved; the response carries
 * nothing the client needs to authenticate later beyond echoing the email.
 *
 * @param {import('express').Request} req
 * @param {{email: string}} req.body - Validated by `emailSchema`.
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next - Receives Joi errors (-> 400
 *   via errorHandler) and any synchronous exception.
 * @returns {void}
 *   - 200 `{ message: 'Login successful', user: { email, createdAt } }`
 *   - 201 `{ message: 'User created and logged in successfully', user: { email, createdAt } }`
 *   - 400 `{ error: 'Validation error', details: string[] }` on invalid body
 *   - 500 `{ error: 'Internal server error' }` / `{ error: 'Failed to create user' }` on DB failure
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
 * `GET /api/auth/me` - returns the profile of the caller identified by `x-user-email`.
 *
 * @description
 * Runs `authenticateUser` inline (this router does not apply it globally
 * because `/login` must stay open). Looks up `users` by `req.userEmail`. In
 * practice the 404 branch is unreachable through normal traffic because the
 * middleware just created the row if it was missing; it remains as a guard.
 *
 * @param {import('express').Request} req
 * @param {string} req.userEmail - Set by `authenticateUser` from the `x-user-email` header.
 * @param {import('express').Response} res
 * @returns {void}
 *   - 200 `{ user: { email, createdAt } }`
 *   - 401 / 400 from `authenticateUser` if the header is missing / malformed
 *   - 404 `{ error: 'User not found' }`
 *   - 500 `{ error: 'Internal server error' }` on DB failure
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
