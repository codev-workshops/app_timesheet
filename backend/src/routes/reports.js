const express = require('express');
const { getDatabase } = require('../database/init');
const { authenticateUser } = require('../middleware/auth');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Router-level auth. All three handlers share the same shape: verify the client
// belongs to the caller, then read that client's entries with the `user_email`
// predicate repeated on the entries query too — defence in depth, since a
// report is the one place where another tenant's hours would be exported
// wholesale.
router.use(authenticateUser);

/**
 * GET /api/reports/client/:clientId — JSON hours report for one client.
 *
 * Totals are summed in JavaScript rather than with SQL `SUM()` because SQLite
 * stores `hours` in a `DECIMAL(5,2)` column that the driver may hand back as a
 * string; `parseFloat` per row keeps the arithmetic predictable. Callers get
 * the raw entries alongside the aggregate so the UI can render the table and
 * the summary cards from a single request.
 *
 * @param {import('express').Request} req Authenticated request with `params.clientId`.
 * @param {import('express').Response} res Receives `{ client, workEntries, totalHours, entryCount }`.
 * @returns {void} 200 with the report, 400 if the id is not numeric, 404 if the
 *   client is not the caller's, 500 on database error.
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
 * GET /api/reports/export/csv/:clientId — downloads the report as a CSV file.
 *
 * Unlike the PDF path, this one round-trips through disk: `csv-writer`'s
 * `createObjectCsvWriter` only knows how to write to a path, so the response
 * cannot be streamed directly. The temp-file lifecycle is therefore:
 *
 * 1. build a collision-resistant name from the client name (non-alphanumerics
 *    replaced, so it is safe as a filesystem and `Content-Disposition` value)
 *    plus an ISO timestamp with `:`/`.` swapped out for `-`;
 * 2. create `backend/temp/` on demand, since it is not checked into the repo;
 * 3. write the file, then `res.download()` it so Express streams it with the
 *    right attachment headers;
 * 4. delete it in the download callback — which fires on failure as well as
 *    success, so a broken connection cannot leak the file. Both the download
 *    and unlink errors are only logged: the response has already begun
 *    streaming by then, so no status code can still be sent.
 *
 * A failure before the download starts (CSV generation) can still answer with
 * 500. Concurrent exports of the same client are safe because the timestamped
 * name is per-request.
 *
 * @param {import('express').Request} req Authenticated request with `params.clientId`.
 * @param {import('express').Response} res Receives a CSV attachment with Date/Hours/Description/Created At columns.
 * @returns {void} 200 with the file, 400 if the id is not numeric, 404 if the
 *   client is not the caller's, 500 on database or CSV-generation error.
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
              res.download(tempPath, filename, (err) => {
                if (err) {
                  console.error('Error sending file:', err);
                }
                // Runs on success and failure alike, so the temp file is
                // removed even if the client disconnects mid-download.
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
 * GET /api/reports/export/pdf/:clientId — streams the report as a PDF.
 *
 * `pdfkit` writes to a stream, so unlike the CSV path this pipes straight into
 * the response and needs no temp file. The trade-off is that headers must be
 * set before `doc.pipe(res)`: once piping starts the response is committed, so
 * any later failure cannot be turned into a 500 — the client would receive a
 * truncated PDF.
 *
 * The table is laid out by hand with absolute coordinates because pdfkit has no
 * table primitive. The magic numbers are column origins in PDF points from the
 * left margin — 50 (Date), 150 (Hours), 230 (Description) — chosen so each
 * column's declared width (100/80/300) ends just before the next origin and the
 * last one stops at the 550-point right edge used by the separator lines.
 *
 * @param {import('express').Request} req Authenticated request with `params.clientId`.
 * @param {import('express').Response} res Receives the PDF as an attachment.
 * @returns {void} 200 with the file, 400 if the id is not numeric, 404 if the
 *   client is not the caller's, 500 on database error (only before streaming starts).
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
          
          // Header row: the first `text()` call advances `doc.y` by one line,
          // so the other two subtract 15 points (roughly one line at this font
          // size) to stay level with it.
          doc.fontSize(12).text('Date', 50, doc.y, { width: 100 });
          doc.text('Hours', 150, doc.y - 15, { width: 80 });
          doc.text('Description', 230, doc.y - 15, { width: 300 });
          doc.moveDown();
          
          // Add horizontal line
          doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
          doc.moveDown(0.5);
          
          workEntries.forEach((entry, index) => {
            // Capture the row's baseline once so the three columns align even
            // though the first `text()` call below moves the cursor.
            const y = doc.y;
            
            // Page break before the row would run off the bottom: the default
            // Letter page is 792 points tall with a 72-point bottom margin, so
            // 700 leaves room for one more line plus a separator.
            if (y > 700) {
              doc.addPage();
            }
            
            doc.text(entry.date, 50, doc.y, { width: 100 });
            doc.text(entry.hours.toString(), 150, y, { width: 80 });
            doc.text(entry.description || 'No description', 230, y, { width: 300 });
            doc.moveDown();
            
            // Rule every fifth row, purely for legibility when scanning long
            // reports.
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
