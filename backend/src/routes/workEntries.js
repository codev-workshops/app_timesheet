const express = require('express');
const { getDatabase } = require('../database/init');
const { authenticateUser } = require('../middleware/auth');
const { workEntrySchema, updateWorkEntrySchema } = require('../validation/schemas');

const router = express.Router();

// Router-level auth, and every query is scoped by `we.user_email`. The JOIN on
// `clients` is not just for the display name: because SQLite foreign keys are
// not enabled, entries whose client was deleted linger as orphans, and the
// inner JOIN is what keeps them out of every response.
router.use(authenticateUser);

/**
 * GET /api/work-entries — lists the caller's entries, newest first.
 *
 * The optional `clientId` query parameter is appended to the WHERE clause as a
 * bound parameter rather than interpolated, and is parsed first so a
 * non-numeric filter fails with 400 instead of silently matching nothing.
 * Ordering by date then `created_at` gives a stable sequence for several
 * entries logged on the same day.
 *
 * @param {import('express').Request} req Authenticated request; `query.clientId` optionally narrows the result.
 * @param {import('express').Response} res Receives `{ workEntries: WorkEntry[] }`, each with `client_name`.
 * @returns {void} 200 with the list, 400 if `clientId` is not numeric, 500 on database error.
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
 * GET /api/work-entries/:id — fetches one entry owned by the caller.
 *
 * @param {import('express').Request} req Authenticated request with `params.id`.
 * @param {import('express').Response} res Receives `{ workEntry: WorkEntry }` including `client_name`.
 * @returns {void} 200 with the entry, 400 if the id is not numeric, 404 if it is
 *   missing, another tenant's, or its client no longer exists (the JOIN drops
 *   orphans), 500 on database error.
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
 * POST /api/work-entries — logs hours against one of the caller's clients.
 *
 * The client lookup before the insert is the only integrity check that exists:
 * the `client_id` foreign key is declared but unenforced, so without it a
 * caller could attach an entry to a client belonging to someone else — or to
 * no client at all, creating a row invisible to every read query. The failure
 * is reported as 400 (bad reference in the submitted body) rather than 404,
 * and worded to avoid revealing whether the id exists for another tenant.
 *
 * @param {import('express').Request} req Body validated by `workEntrySchema`.
 * @param {import('express').Response} res Receives `{ message, workEntry }` with `client_name` joined in.
 * @param {import('express').NextFunction} next Receives Joi validation errors.
 * @returns {void} 201 with the created entry, 400 on validation failure or an
 *   unowned `clientId`, 500 if the insert fails or the row cannot be read back.
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
 * PUT /api/work-entries/:id — partially updates one of the caller's entries.
 *
 * The nesting reflects two independent ownership questions that must both be
 * answered before anything is written, and `sqlite3` is callback-based, so they
 * cannot be sequenced with `await`:
 *
 * 1. Does this entry belong to the caller? A scoped UPDATE matching zero rows
 *    is not an error in SQLite, so without this SELECT a foreign id would look
 *    like a successful edit instead of a 404.
 * 2. If the body re-points the entry at a different client, does that client
 *    belong to the caller? Foreign keys are not enforced here, so this check is
 *    what stops an entry from being moved onto another tenant's client (or a
 *    non-existent one). It runs only when `clientId` was supplied — hence the
 *    branch — and reports 400 because the offending value came from the body.
 *
 * `performUpdate()` is a closure rather than inline code precisely so both
 * branches converge on one copy of the write logic. It is a hoisted function
 * declaration, which is why the calls above can reference it.
 *
 * The SET clause is built from only the provided fields: a fixed statement
 * would null out the columns the caller omitted, making every partial edit a
 * full replace. Column names are hardcoded per branch and all values are bound
 * parameters, so the dynamic SQL is injection-safe; `updated_at` is always
 * appended.
 *
 * The final read-back deliberately omits `user_email` from its WHERE clause —
 * ownership was already established above and the row is keyed by id.
 *
 * @param {import('express').Request} req Body validated by `updateWorkEntrySchema`; `params.id` selects the row.
 * @param {import('express').Response} res Receives `{ message, workEntry }` with the refreshed row.
 * @param {import('express').NextFunction} next Receives Joi validation errors.
 * @returns {void} 200 with the updated entry, 400 if the id is not numeric, the
 *   body is invalid, or `clientId` is not the caller's, 404 if the entry is not
 *   the caller's, 500 on database error.
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

        // Re-pointing the entry at another client requires proving ownership
        // of that client first; the database will not do it for us.
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

        // Shared write step for both branches above.
        function performUpdate() {
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
 * DELETE /api/work-entries/:id — deletes one of the caller's entries.
 *
 * The SELECT first is what turns a scoped DELETE matching zero rows (not an
 * error in SQLite) into an honest 404; the DELETE keeps the `user_email`
 * predicate anyway so it cannot escape the tenant.
 *
 * @param {import('express').Request} req Authenticated request with `params.id`.
 * @param {import('express').Response} res Receives `{ message }`.
 * @returns {void} 200 on success, 400 if the id is not numeric, 404 if the entry
 *   is not the caller's, 500 on database error.
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
