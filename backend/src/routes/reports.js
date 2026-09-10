/**
 * @fileoverview Per-client reporting/export routes, mounted at `/api/reports`.
 *
 * Every route runs behind `authenticateUser` (`x-user-email` header required;
 * 401 missing / 400 malformed). Each handler first resolves the client with
 * `WHERE id = ? AND user_email = ?`, returning 404 when it is missing or owned
 * by someone else, and then reads work entries with the same `user_email`
 * filter. Reports are computed on the fly from the in-memory database; nothing
 * is cached or persisted (the CSV export writes a temp file only for the
 * duration of the download).
 */
const express = require('express');
const { getDatabase } = require('../database/init');
const { authenticateUser } = require('../middleware/auth');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// All routes require authentication
router.use(authenticateUser);

/**
 * `GET /api/reports/client/:clientId` - JSON hours summary for one client.
 *
 * @description
 * Returns the client's entries (newest first) plus aggregates computed in
 * JavaScript: `totalHours` is the `parseFloat` sum of `hours`, `entryCount` is
 * the row count. Aggregation is done in Node rather than SQL so the entry list
 * and totals come from one result set.
 *
 * @param {import('express').Request} req
 * @param {string} req.params.clientId - Client id (`parseInt`).
 * @param {string} req.userEmail - Owner filter for both client and entries.
 * @param {import('express').Response} res
 * @returns {void}
 *   - 200 `{ client: { id, name }, workEntries: Array<{ id, hours, description, date, created_at, updated_at }>, totalHours: number, entryCount: number }`
 *   - 400 `{ error: 'Invalid client ID' }`
 *   - 404 `{ error: 'Client not found' }`
 *   - 500 `{ error: 'Internal server error' }`
 */
router.get('/client/:clientId', (req, res) => {
  const clientId = parseInt(req.params.clientId);
  
  if (isNaN(clientId)) {
    return res.status(400).json({ error: 'Invalid client ID' });
  }
  
  const db = getDatabase();
  
  // Verify client belongs to user
  db.get(
    'SELECT id, name FROM clients WHERE id = ? AND user_email = ?',
    [clientId, req.userEmail],
    (err, client) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }
      
      // Get work entries for this client
      db.all(
        `SELECT id, hours, description, date, created_at, updated_at
         FROM work_entries 
         WHERE client_id = ? AND user_email = ? 
         ORDER BY date DESC`,
        [clientId, req.userEmail],
        (err, workEntries) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
          }
          
          // Calculate total hours
          const totalHours = workEntries.reduce((sum, entry) => sum + parseFloat(entry.hours), 0);
          
          res.json({
            client: client,
            workEntries: workEntries,
            totalHours: totalHours,
            entryCount: workEntries.length
          });
        }
      );
    }
  );
});

/**
 * `GET /api/reports/export/csv/:clientId` - download the client's entries as CSV.
 *
 * @description
 * Columns: `Date, Hours, Description, Created At`. Because `csv-writer` only
 * writes to disk, the handler writes `<backend>/temp/<sanitised client name>_report_<timestamp>.csv`
 * (creating `temp/` if needed), streams it with `res.download()`, and unlinks
 * the file in the download callback regardless of success. The client name is
 * reduced to `[a-zA-Z0-9_]` for the filename so it is safe as a path segment
 * and a `Content-Disposition` value. Errors after headers are sent are only
 * logged.
 *
 * @param {import('express').Request} req
 * @param {string} req.params.clientId - Client id (`parseInt`).
 * @param {string} req.userEmail - Owner filter.
 * @param {import('express').Response} res
 * @returns {void}
 *   - 200 `text/csv` attachment
 *   - 400 `{ error: 'Invalid client ID' }`
 *   - 404 `{ error: 'Client not found' }`
 *   - 500 `{ error: 'Internal server error' }` (DB) or `{ error: 'Failed to generate CSV report' }` (write)
 */
router.get('/export/csv/:clientId', (req, res) => {
  const clientId = parseInt(req.params.clientId);
  
  if (isNaN(clientId)) {
    return res.status(400).json({ error: 'Invalid client ID' });
  }
  
  const db = getDatabase();
  
  // Verify client belongs to user and get data
  db.get(
    'SELECT id, name FROM clients WHERE id = ? AND user_email = ?',
    [clientId, req.userEmail],
    (err, client) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }
      
      // Get work entries
      db.all(
        `SELECT hours, description, date, created_at
         FROM work_entries 
         WHERE client_id = ? AND user_email = ? 
         ORDER BY date DESC`,
        [clientId, req.userEmail],
        (err, workEntries) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
          }
          
          // Create temporary CSV file
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `${client.name.replace(/[^a-zA-Z0-9]/g, '_')}_report_${timestamp}.csv`;
          const tempPath = path.join(__dirname, '../../temp', filename);
          
          // Ensure temp directory exists
          const tempDir = path.dirname(tempPath);
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          
          const csvWriter = createCsvWriter({
            path: tempPath,
            header: [
              { id: 'date', title: 'Date' },
              { id: 'hours', title: 'Hours' },
              { id: 'description', title: 'Description' },
              { id: 'created_at', title: 'Created At' }
            ]
          });
          
          csvWriter.writeRecords(workEntries)
            .then(() => {
              // Send file and clean up
              res.download(tempPath, filename, (err) => {
                if (err) {
                  console.error('Error sending file:', err);
                }
                // Clean up temp file
                fs.unlink(tempPath, (unlinkErr) => {
                  if (unlinkErr) {
                    console.error('Error deleting temp file:', unlinkErr);
                  }
                });
              });
            })
            .catch((error) => {
              console.error('Error creating CSV:', error);
              res.status(500).json({ error: 'Failed to generate CSV report' });
            });
        }
      );
    }
  );
});

/**
 * `GET /api/reports/export/pdf/:clientId` - download the client's entries as PDF.
 *
 * @description
 * Builds the document with `pdfkit` and pipes it straight to the response (no
 * temp file, unlike the CSV export). Layout: title, total hours / entry count /
 * generation time, then a simple Date | Hours | Description table with a rule
 * every 5 rows and a new page once `doc.y` passes 700. Headers set:
 * `Content-Type: application/pdf` and an attachment `Content-Disposition` using
 * the same sanitised filename scheme as the CSV export. Once piping has begun
 * no JSON error can be returned; failures surface as a truncated stream.
 *
 * @param {import('express').Request} req
 * @param {string} req.params.clientId - Client id (`parseInt`).
 * @param {string} req.userEmail - Owner filter.
 * @param {import('express').Response} res
 * @returns {void}
 *   - 200 `application/pdf` attachment
 *   - 400 `{ error: 'Invalid client ID' }`
 *   - 404 `{ error: 'Client not found' }`
 *   - 500 `{ error: 'Internal server error' }` (DB errors before streaming starts)
 */
router.get('/export/pdf/:clientId', (req, res) => {
  const clientId = parseInt(req.params.clientId);
  
  if (isNaN(clientId)) {
    return res.status(400).json({ error: 'Invalid client ID' });
  }
  
  const db = getDatabase();
  
  // Verify client belongs to user and get data
  db.get(
    'SELECT id, name FROM clients WHERE id = ? AND user_email = ?',
    [clientId, req.userEmail],
    (err, client) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }
      
      // Get work entries
      db.all(
        `SELECT hours, description, date, created_at
         FROM work_entries 
         WHERE client_id = ? AND user_email = ? 
         ORDER BY date DESC`,
        [clientId, req.userEmail],
        (err, workEntries) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
          }
          
          // Create PDF
          const doc = new PDFDocument();
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `${client.name.replace(/[^a-zA-Z0-9]/g, '_')}_report_${timestamp}.pdf`;
          
          // Set response headers
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          
          // Pipe PDF to response
          doc.pipe(res);
          
          // Add content to PDF
          doc.fontSize(20).text(`Time Report for ${client.name}`, { align: 'center' });
          doc.moveDown();
          
          const totalHours = workEntries.reduce((sum, entry) => sum + parseFloat(entry.hours), 0);
          doc.fontSize(14).text(`Total Hours: ${totalHours.toFixed(2)}`);
          doc.text(`Total Entries: ${workEntries.length}`);
          doc.text(`Generated: ${new Date().toLocaleString()}`);
          doc.moveDown();
          
          // Add table header
          doc.fontSize(12).text('Date', 50, doc.y, { width: 100 });
          doc.text('Hours', 150, doc.y - 15, { width: 80 });
          doc.text('Description', 230, doc.y - 15, { width: 300 });
          doc.moveDown();
          
          // Add horizontal line
          doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
          doc.moveDown(0.5);
          
          // Add work entries
          workEntries.forEach((entry, index) => {
            const y = doc.y;
            
            // Check if we need a new page
            if (y > 700) {
              doc.addPage();
            }
            
            doc.text(entry.date, 50, doc.y, { width: 100 });
            doc.text(entry.hours.toString(), 150, y, { width: 80 });
            doc.text(entry.description || 'No description', 230, y, { width: 300 });
            doc.moveDown();
            
            // Add separator line every 5 entries
            if ((index + 1) % 5 === 0) {
              doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
              doc.moveDown(0.5);
            }
          });
          
          // Finalize PDF
          doc.end();
        }
      );
    }
  );
});

module.exports = router;
