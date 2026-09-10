/**
 * @fileoverview Client (customer/project) CRUD routes, mounted at `/api/clients`.
 *
 * Every route runs behind `authenticateUser`, so the `x-user-email` header is
 * required (401 if missing, 400 if malformed) and `req.userEmail` is set.
 * Tenancy is enforced purely in SQL: every SELECT/UPDATE/DELETE includes
 * `AND user_email = ?` bound to `req.userEmail`, so a caller can never read or
 * mutate another user's client even by guessing its numeric id (such requests
 * surface as 404, not 403). All queries are parameterised.
 *
 * Client shape returned by these routes:
 * `{ id, name, description, department, email, created_at, updated_at }`
 * (`user_email` is never returned).
 */
const express = require('express');
const { getDatabase } = require('../database/init');
const { authenticateUser } = require('../middleware/auth');
const { clientSchema, updateClientSchema } = require('../validation/schemas');

const router = express.Router();

// All routes require authentication
router.use(authenticateUser);

/**
 * `GET /api/clients` - list all clients owned by the caller, ordered by name.
 *
 * @param {import('express').Request} req
 * @param {string} req.userEmail - Owner filter (from `x-user-email`).
 * @param {import('express').Response} res
 * @returns {void}
 *   - 200 `{ clients: Client[] }` (empty array when the user has none)
 *   - 500 `{ error: 'Internal server error' }`
 */
router.get('/', (req, res) => {
  const db = getDatabase();
  
  db.all(
    'SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE user_email = ? ORDER BY name',
    [req.userEmail],
    (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      res.json({ clients: rows });
    }
  );
});

/**
 * `GET /api/clients/:id` - fetch one client owned by the caller.
 *
 * @param {import('express').Request} req
 * @param {string} req.params.id - Client id; parsed with `parseInt`, so
 *   `"12abc"` is accepted as 12 while non-numeric input yields 400.
 * @param {string} req.userEmail - Owner filter.
 * @param {import('express').Response} res
 * @returns {void}
 *   - 200 `{ client: Client }`
 *   - 400 `{ error: 'Invalid client ID' }`
 *   - 404 `{ error: 'Client not found' }` (also when the id belongs to another user)
 *   - 500 `{ error: 'Internal server error' }`
 */
router.get('/:id', (req, res) => {
  const clientId = parseInt(req.params.id);
  
  if (isNaN(clientId)) {
    return res.status(400).json({ error: 'Invalid client ID' });
  }
  
  const db = getDatabase();
  
  db.get(
    'SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE id = ? AND user_email = ?',
    [clientId, req.userEmail],
    (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Client not found' });
      }
      
      res.json({ client: row });
    }
  );
});

/**
 * `POST /api/clients` - create a client owned by the caller.
 *
 * @description
 * Validates the body with `clientSchema`, INSERTs with `user_email =
 * req.userEmail`, then re-SELECTs the row by `this.lastID` so the response
 * includes DB-generated `id`/timestamps. Optional fields that validate as `''`
 * are stored as `NULL`.
 *
 * @param {import('express').Request} req
 * @param {{name: string, description?: string, department?: string, email?: string}} req.body
 * @param {string} req.userEmail - Stored as the client's owner.
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next - Receives Joi errors (-> 400).
 * @returns {void}
 *   - 201 `{ message: 'Client created successfully', client: Client }`
 *   - 400 `{ error: 'Validation error', details: string[] }`
 *   - 500 `{ error: 'Failed to create client' }` or
 *     `{ error: 'Client created but failed to retrieve' }` (row was inserted)
 */
router.post('/', (req, res, next) => {
  try {
    const { error, value } = clientSchema.validate(req.body);
    if (error) {
      return next(error);
    }

    const { name, description, department, email } = value;
    const db = getDatabase();

    db.run(
      'INSERT INTO clients (name, description, department, email, user_email) VALUES (?, ?, ?, ?, ?)',
      [name, description || null, department || null, email || null, req.userEmail],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to create client' });
        }

        // Return the created client
        db.get(
          'SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE id = ?',
          [this.lastID],
          (err, row) => {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Client created but failed to retrieve' });
            }

            res.status(201).json({ 
              message: 'Client created successfully',
              client: row 
            });
          }
        );
      }
    );
  } catch (error) {
    next(error);
  }
});

/**
 * `PUT /api/clients/:id` - partial update of a client owned by the caller.
 *
 * @description
 * Despite the PUT verb this behaves like PATCH: the body is validated with
 * `updateClientSchema` (all fields optional, at least one required) and only
 * the supplied keys are written. The SET clause is assembled from a fixed
 * whitelist of column names, with values always bound as `?` parameters, so the
 * dynamic string is not an injection vector. `updated_at` is always bumped.
 * Ownership is checked twice: a preliminary SELECT (to return 404) and the
 * `WHERE id = ? AND user_email = ?` on the UPDATE itself.
 *
 * @param {import('express').Request} req
 * @param {string} req.params.id - Client id (`parseInt`).
 * @param {{name?: string, description?: string, department?: string, email?: string}} req.body
 * @param {string} req.userEmail - Owner filter.
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next - Receives Joi errors (-> 400).
 * @returns {void}
 *   - 200 `{ message: 'Client updated successfully', client: Client }`
 *   - 400 `{ error: 'Invalid client ID' }` or `{ error: 'Validation error', details }`
 *   - 404 `{ error: 'Client not found' }`
 *   - 500 `{ error: 'Internal server error' | 'Failed to update client' | 'Client updated but failed to retrieve' }`
 */
router.put('/:id', (req, res, next) => {
  try {
    const clientId = parseInt(req.params.id);
    
    if (isNaN(clientId)) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }

    const { error, value } = updateClientSchema.validate(req.body);
    if (error) {
      return next(error);
    }

    const db = getDatabase();

    // Check if client exists and belongs to user
    db.get(
      'SELECT id FROM clients WHERE id = ? AND user_email = ?',
      [clientId, req.userEmail],
      (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (!row) {
          return res.status(404).json({ error: 'Client not found' });
        }

        // Build update query dynamically
        const updates = [];
        const values = [];

        if (value.name !== undefined) {
          updates.push('name = ?');
          values.push(value.name);
        }

        if (value.description !== undefined) {
          updates.push('description = ?');
          values.push(value.description || null);
        }

        if (value.department !== undefined) {
          updates.push('department = ?');
          values.push(value.department || null);
        }

        if (value.email !== undefined) {
          updates.push('email = ?');
          values.push(value.email || null);
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(clientId, req.userEmail);

        const query = `UPDATE clients SET ${updates.join(', ')} WHERE id = ? AND user_email = ?`;

        db.run(query, values, function(err) {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to update client' });
          }

          // Return updated client
          db.get(
            'SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE id = ?',
            [clientId],
            (err, row) => {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Client updated but failed to retrieve' });
              }

              res.json({
                message: 'Client updated successfully',
                client: row
              });
            }
          );
        });
      }
    );
  } catch (error) {
    next(error);
  }
});

/**
 * `DELETE /api/clients` - delete every client owned by the caller.
 *
 * @description
 * Bulk reset scoped by `user_email`; other users' data is untouched. The
 * schema declares `work_entries.client_id ... ON DELETE CASCADE`, but note that
 * SQLite only honours cascades when `PRAGMA foreign_keys = ON`, which this
 * codebase never sets, so dependent work entries may be left orphaned.
 *
 * @param {import('express').Request} req
 * @param {string} req.userEmail - Owner filter.
 * @param {import('express').Response} res
 * @returns {void}
 *   - 200 `{ message: 'All clients deleted successfully', deletedCount: number }`
 *   - 500 `{ error: 'Failed to delete clients' }`
 */
router.delete('/', (req, res) => {
  const db = getDatabase();
  
  db.run(
    'DELETE FROM clients WHERE user_email = ?',
    [req.userEmail],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to delete clients' });
      }
      
      res.json({ 
        message: 'All clients deleted successfully',
        deletedCount: this.changes
      });
    }
  );
});

/**
 * `DELETE /api/clients/:id` - delete one client owned by the caller.
 *
 * @description
 * Verifies ownership with a SELECT first (so a foreign id yields 404 rather
 * than a silent no-op), then DELETEs with the same `id + user_email` filter.
 * See `DELETE /api/clients` regarding the cascade caveat for work entries.
 *
 * @param {import('express').Request} req
 * @param {string} req.params.id - Client id (`parseInt`).
 * @param {string} req.userEmail - Owner filter.
 * @param {import('express').Response} res
 * @returns {void}
 *   - 200 `{ message: 'Client deleted successfully' }`
 *   - 400 `{ error: 'Invalid client ID' }`
 *   - 404 `{ error: 'Client not found' }`
 *   - 500 `{ error: 'Internal server error' | 'Failed to delete client' }`
 */
router.delete('/:id', (req, res) => {
  const clientId = parseInt(req.params.id);
  
  if (isNaN(clientId)) {
    return res.status(400).json({ error: 'Invalid client ID' });
  }
  
  const db = getDatabase();
  
  // Check if client exists and belongs to user
  db.get(
    'SELECT id FROM clients WHERE id = ? AND user_email = ?',
    [clientId, req.userEmail],
    (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Client not found' });
      }
      
      // Delete client (work entries will be deleted due to CASCADE)
      db.run(
        'DELETE FROM clients WHERE id = ? AND user_email = ?',
        [clientId, req.userEmail],
        function(err) {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to delete client' });
          }
          
          res.json({ message: 'Client deleted successfully' });
        }
      );
    }
  );
});

module.exports = router;
