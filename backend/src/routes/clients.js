const express = require('express');
const { getDatabase } = require('../database/init');
const { authenticateUser } = require('../middleware/auth');
const { clientSchema, updateClientSchema } = require('../validation/schemas');

const router = express.Router();

// Router-level auth: every handler below can assume `req.userEmail` exists.
// Each query is additionally scoped by `user_email` rather than trusting the
// row id alone — client ids are sequential integers, so an id-only lookup
// would let one tenant read or destroy another's data by guessing. Scoping the
// WHERE clause also makes "not yours" indistinguishable from "not found",
// which avoids leaking which ids exist.
router.use(authenticateUser);

/**
 * GET /api/clients — lists the caller's clients, alphabetically by name.
 *
 * Sorted server-side so every consumer (table, dropdowns on the work-entry and
 * report pages) shows the same order without re-sorting.
 *
 * @param {import('express').Request} req Authenticated request.
 * @param {import('express').Response} res Receives `{ clients: Client[] }` (empty array when none).
 * @returns {void} 200 with the list, 500 on database error.
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
 * GET /api/clients/:id — fetches one client owned by the caller.
 *
 * `:id` is parsed here because Express params are strings and SQLite would
 * happily compare a non-numeric string against an INTEGER column, silently
 * returning nothing; failing fast with a 400 distinguishes a malformed request
 * from a missing row.
 *
 * @param {import('express').Request} req Authenticated request with `params.id`.
 * @param {import('express').Response} res Receives `{ client: Client }`.
 * @returns {void} 200 with the client, 400 if the id is not numeric, 404 if it
 *   does not exist or belongs to someone else, 500 on database error.
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
 * POST /api/clients — creates a client owned by the caller.
 *
 * `user_email` comes from the authenticated request, never from the body, so a
 * caller cannot create rows on another tenant's behalf. Empty optional fields
 * are stored as NULL rather than `''` so the frontend's "no description"
 * placeholders and any future NULL-aware queries behave consistently.
 *
 * The insert is followed by a read of `this.lastID` because SQLite fills in
 * `id`, `created_at` and `updated_at`; returning the stored row saves the
 * client a refetch and guarantees it sees the persisted values.
 *
 * @param {import('express').Request} req Body validated by `clientSchema`.
 * @param {import('express').Response} res Receives `{ message, client: Client }`.
 * @param {import('express').NextFunction} next Receives Joi validation errors.
 * @returns {void} 201 with the created client, 400 on validation failure, 500 if
 *   the insert fails or the row cannot be read back.
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
 * PUT /api/clients/:id — partially updates a client owned by the caller.
 *
 * Ownership is checked with a separate SELECT first so a foreign or missing id
 * yields 404 rather than a successful-looking UPDATE that matched zero rows
 * (SQLite reports no error for that).
 *
 * The SET clause is assembled from only the keys present in the validated body:
 * a fixed statement would overwrite omitted columns with NULL, turning every
 * partial edit into a full replace. Column names are hardcoded per branch and
 * values are bound as parameters, so the dynamic SQL carries no injection risk.
 * `updated_at` is always appended, which is why the array is never empty even
 * though the schema already enforces at least one field.
 *
 * @param {import('express').Request} req Body validated by `updateClientSchema`; `params.id` selects the row.
 * @param {import('express').Response} res Receives `{ message, client: Client }` with the refreshed row.
 * @param {import('express').NextFunction} next Receives Joi validation errors.
 * @returns {void} 200 with the updated client, 400 if the id is not numeric or
 *   the body is invalid, 404 if the client is not the caller's, 500 on database error.
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

        // Only the supplied fields are written; see the JSDoc above for why a
        // static UPDATE would clobber the omitted columns.
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
 * DELETE /api/clients — bulk-deletes every client owned by the caller.
 *
 * A convenience for resetting a demo/workshop dataset. It is defined before
 * `DELETE /:id` on purpose: Express matches in declaration order, and although
 * an empty path would not collide today, keeping the specific-to-general order
 * documents the intent.
 *
 * The `user_email` predicate is the only thing preventing this from wiping the
 * whole table, so it must never be dropped "because there is no id". Note that
 * SQLite's `ON DELETE CASCADE` is not active without
 * `PRAGMA foreign_keys = ON`, so the deleted clients' work entries survive as
 * orphans; the work-entry queries JOIN on `clients`, so those rows simply stop
 * appearing.
 *
 * @param {import('express').Request} req Authenticated request.
 * @param {import('express').Response} res Receives `{ message, deletedCount }` from `this.changes`.
 * @returns {void} 200 with the number of rows removed (0 is a success), 500 on database error.
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
 * DELETE /api/clients/:id — deletes one client owned by the caller.
 *
 * The SELECT before the DELETE exists to distinguish "already gone / not
 * yours" (404) from a successful delete, since a scoped DELETE that matches
 * nothing is not an error. Both statements keep the `user_email` predicate so
 * the delete cannot escape the tenant even if the check is ever refactored away.
 *
 * @param {import('express').Request} req Authenticated request with `params.id`.
 * @param {import('express').Response} res Receives `{ message }`.
 * @returns {void} 200 on success, 400 if the id is not numeric, 404 if the
 *   client is not the caller's, 500 on database error.
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
      
      // The schema declares ON DELETE CASCADE, but foreign keys are not
      // enabled on this connection, so related work entries are left behind
      // and are hidden only because the work-entry queries JOIN on clients.
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
