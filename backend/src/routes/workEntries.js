/**
 * @fileoverview Work-entry (timesheet line) CRUD routes, mounted at `/api/work-entries`.
 *
 * Every route runs behind `authenticateUser`, so the `x-user-email` header is
 * required (401 missing / 400 malformed) and `req.userEmail` is populated.
 * Isolation is enforced in SQL with `we.user_email = ?` on every statement, and
 * additionally any `clientId` supplied on create/update is checked to belong
 * to the same user, so a work entry can never be attached to another tenant's
 * client. All queries are parameterised.
 *
 * WorkEntry shape returned by these routes (joined with `clients` for the name):
 * `{ id, client_id, hours, description, date, created_at, updated_at, client_name }`
 */
const express = require('express');
const { getDatabase } = require('../database/init');
const { authenticateUser } = require('../middleware/auth');
const { workEntrySchema, updateWorkEntrySchema } = require('../validation/schemas');

const router = express.Router();

// All routes require authentication
router.use(authenticateUser);

/**
 * `GET /api/work-entries` - list the caller's work entries, newest first.
 *
 * @description
 * Optional `?clientId=` narrows to one client. The filter is appended as an
 * extra `AND we.client_id = ?` parameter (no ownership check on the client is
 * needed because `we.user_email = ?` already restricts rows). Ordered by
 * `date DESC, created_at DESC`.
 *
 * @param {import('express').Request} req
 * @param {string} [req.query.clientId] - Numeric client id (`parseInt`).
 * @param {string} req.userEmail - Owner filter.
 * @param {import('express').Response} res
 * @returns {void}
 *   - 200 `{ workEntries: WorkEntry[] }`
 *   - 400 `{ error: 'Invalid client ID' }` if `clientId` is present but non-numeric
 *   - 500 `{ error: 'Internal server error' }`
 */
router.get('/', (req, res) => {
  const { clientId } = req.query;
  const db = getDatabase();
  
  let query = `
    SELECT we.id, we.client_id, we.hours, we.description, we.date, 
           we.created_at, we.updated_at, c.name as client_name
    FROM work_entries we
    JOIN clients c ON we.client_id = c.id
    WHERE we.user_email = ?
  `;
  
  const params = [req.userEmail];
  
  if (clientId) {
    const clientIdNum = parseInt(clientId);
    if (isNaN(clientIdNum)) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }
    query += ' AND we.client_id = ?';
    params.push(clientIdNum);
  }
  
  query += ' ORDER BY we.date DESC, we.created_at DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    res.json({ workEntries: rows });
  });
});

/**
 * `GET /api/work-entries/:id` - fetch one work entry owned by the caller.
 *
 * @param {import('express').Request} req
 * @param {string} req.params.id - Work entry id (`parseInt`).
 * @param {string} req.userEmail - Owner filter.
 * @param {import('express').Response} res
 * @returns {void}
 *   - 200 `{ workEntry: WorkEntry }`
 *   - 400 `{ error: 'Invalid work entry ID' }`
 *   - 404 `{ error: 'Work entry not found' }` (also for another user's entry)
 *   - 500 `{ error: 'Internal server error' }`
 */
router.get('/:id', (req, res) => {
  const workEntryId = parseInt(req.params.id);
  
  if (isNaN(workEntryId)) {
    return res.status(400).json({ error: 'Invalid work entry ID' });
  }
  
  const db = getDatabase();
  
  db.get(
    `SELECT we.id, we.client_id, we.hours, we.description, we.date, 
            we.created_at, we.updated_at, c.name as client_name
     FROM work_entries we
     JOIN clients c ON we.client_id = c.id
     WHERE we.id = ? AND we.user_email = ?`,
    [workEntryId, req.userEmail],
    (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Work entry not found' });
      }
      
      res.json({ workEntry: row });
    }
  );
});

/**
 * `POST /api/work-entries` - log hours against one of the caller's clients.
 *
 * @description
 * Validates with `workEntrySchema`, then confirms `clientId` exists AND belongs
 * to `req.userEmail` before inserting. A client that exists but is owned by
 * someone else is reported as 400 (not 404) so the response is indistinguishable
 * from a non-existent client. After INSERT the row is re-SELECTed (joined with
 * `clients`) so the response includes `client_name` and DB timestamps.
 *
 * @param {import('express').Request} req
 * @param {{clientId: number, hours: number, description?: string, date: string}} req.body
 * @param {string} req.userEmail - Stored as the entry's owner.
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next - Receives Joi errors (-> 400).
 * @returns {void}
 *   - 201 `{ message: 'Work entry created successfully', workEntry: WorkEntry }`
 *   - 400 `{ error: 'Validation error', details }` or
 *     `{ error: 'Client not found or does not belong to user' }`
 *   - 500 `{ error: 'Internal server error' | 'Failed to create work entry' | 'Work entry created but failed to retrieve' }`
 */
router.post('/', (req, res, next) => {
  try {
    const { error, value } = workEntrySchema.validate(req.body);
    if (error) {
      return next(error);
    }

    const { clientId, hours, description, date } = value;
    const db = getDatabase();

    // Verify client exists and belongs to user
    db.get(
      'SELECT id FROM clients WHERE id = ? AND user_email = ?',
      [clientId, req.userEmail],
      (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (!row) {
          return res.status(400).json({ error: 'Client not found or does not belong to user' });
        }

        // Create work entry
        db.run(
          'INSERT INTO work_entries (client_id, user_email, hours, description, date) VALUES (?, ?, ?, ?, ?)',
          [clientId, req.userEmail, hours, description || null, date],
          function(err) {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Failed to create work entry' });
            }

            // Return the created work entry with client name
            db.get(
              `SELECT we.id, we.client_id, we.hours, we.description, we.date, 
                      we.created_at, we.updated_at, c.name as client_name
               FROM work_entries we
               JOIN clients c ON we.client_id = c.id
               WHERE we.id = ?`,
              [this.lastID],
              (err, row) => {
                if (err) {
                  console.error('Database error:', err);
                  return res.status(500).json({ error: 'Work entry created but failed to retrieve' });
                }

                res.status(201).json({
                  message: 'Work entry created successfully',
                  workEntry: row
                });
              }
            );
          }
        );
      }
    );
  } catch (error) {
    next(error);
  }
});

/**
 * `PUT /api/work-entries/:id` - partial update of one of the caller's entries.
 *
 * @description
 * PATCH semantics under a PUT verb: `updateWorkEntrySchema` accepts any subset
 * of fields (at least one). Steps:
 * 1. Verify the entry exists for `req.userEmail` (else 404).
 * 2. If `clientId` is being changed, verify the new client also belongs to the
 *    caller (else 400) - this prevents re-pointing an entry at another tenant's
 *    client.
 * 3. Build the SET clause from a fixed column whitelist with `?` bindings,
 *    always including `updated_at = CURRENT_TIMESTAMP`, and UPDATE with
 *    `WHERE id = ? AND user_email = ?`.
 * 4. Re-SELECT the joined row for the response.
 *
 * @param {import('express').Request} req
 * @param {string} req.params.id - Work entry id (`parseInt`).
 * @param {{clientId?: number, hours?: number, description?: string, date?: string}} req.body
 * @param {string} req.userEmail - Owner filter.
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next - Receives Joi errors (-> 400).
 * @returns {void}
 *   - 200 `{ message: 'Work entry updated successfully', workEntry: WorkEntry }`
 *   - 400 `{ error: 'Invalid work entry ID' }`, `{ error: 'Validation error', details }`,
 *     or `{ error: 'Client not found or does not belong to user' }`
 *   - 404 `{ error: 'Work entry not found' }`
 *   - 500 `{ error: 'Internal server error' | 'Failed to update work entry' | 'Work entry updated but failed to retrieve' }`
 */
router.put('/:id', (req, res, next) => {
  try {
    const workEntryId = parseInt(req.params.id);
    
    if (isNaN(workEntryId)) {
      return res.status(400).json({ error: 'Invalid work entry ID' });
    }

    const { error, value } = updateWorkEntrySchema.validate(req.body);
    if (error) {
      return next(error);
    }

    const db = getDatabase();

    // Check if work entry exists and belongs to user
    db.get(
      'SELECT id FROM work_entries WHERE id = ? AND user_email = ?',
      [workEntryId, req.userEmail],
      (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (!row) {
          return res.status(404).json({ error: 'Work entry not found' });
        }

        // If clientId is being updated, verify it belongs to user
        if (value.clientId) {
          db.get(
            'SELECT id FROM clients WHERE id = ? AND user_email = ?',
            [value.clientId, req.userEmail],
            (err, clientRow) => {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
              }

              if (!clientRow) {
                return res.status(400).json({ error: 'Client not found or does not belong to user' });
              }

              performUpdate();
            }
          );
        } else {
          performUpdate();
        }

        function performUpdate() {
          // Build update query dynamically
          const updates = [];
          const values = [];

          if (value.clientId !== undefined) {
            updates.push('client_id = ?');
            values.push(value.clientId);
          }

          if (value.hours !== undefined) {
            updates.push('hours = ?');
            values.push(value.hours);
          }

          if (value.description !== undefined) {
            updates.push('description = ?');
            values.push(value.description || null);
          }

          if (value.date !== undefined) {
            updates.push('date = ?');
            values.push(value.date);
          }

          updates.push('updated_at = CURRENT_TIMESTAMP');
          values.push(workEntryId, req.userEmail);

          const query = `UPDATE work_entries SET ${updates.join(', ')} WHERE id = ? AND user_email = ?`;

          db.run(query, values, function(err) {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Failed to update work entry' });
            }

            // Return updated work entry with client name
            db.get(
              `SELECT we.id, we.client_id, we.hours, we.description, we.date, 
                      we.created_at, we.updated_at, c.name as client_name
               FROM work_entries we
               JOIN clients c ON we.client_id = c.id
               WHERE we.id = ?`,
              [workEntryId],
              (err, row) => {
                if (err) {
                  console.error('Database error:', err);
                  return res.status(500).json({ error: 'Work entry updated but failed to retrieve' });
                }

                res.json({
                  message: 'Work entry updated successfully',
                  workEntry: row
                });
              }
            );
          });
        }
      }
    );
  } catch (error) {
    next(error);
  }
});

/**
 * `DELETE /api/work-entries/:id` - delete one of the caller's work entries.
 *
 * @description
 * Ownership is verified with a SELECT first so a foreign id yields 404 rather
 * than a silent no-op; the DELETE repeats the `id + user_email` filter.
 *
 * @param {import('express').Request} req
 * @param {string} req.params.id - Work entry id (`parseInt`).
 * @param {string} req.userEmail - Owner filter.
 * @param {import('express').Response} res
 * @returns {void}
 *   - 200 `{ message: 'Work entry deleted successfully' }`
 *   - 400 `{ error: 'Invalid work entry ID' }`
 *   - 404 `{ error: 'Work entry not found' }`
 *   - 500 `{ error: 'Internal server error' | 'Failed to delete work entry' }`
 */
router.delete('/:id', (req, res) => {
  const workEntryId = parseInt(req.params.id);
  
  if (isNaN(workEntryId)) {
    return res.status(400).json({ error: 'Invalid work entry ID' });
  }
  
  const db = getDatabase();
  
  // Check if work entry exists and belongs to user
  db.get(
    'SELECT id FROM work_entries WHERE id = ? AND user_email = ?',
    [workEntryId, req.userEmail],
    (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Work entry not found' });
      }
      
      // Delete work entry
      db.run(
        'DELETE FROM work_entries WHERE id = ? AND user_email = ?',
        [workEntryId, req.userEmail],
        function(err) {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to delete work entry' });
          }
          
          res.json({ message: 'Work entry deleted successfully' });
        }
      );
    }
  );
});

module.exports = router;
