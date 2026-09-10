const express = require('express');
const { getDatabase } = require('../database/init');
const { authenticateUser } = require('../middleware/auth');
const PDFDocument = require('pdfkit');

const router = express.Router();

// All routes require authentication
router.use(authenticateUser);

const CLIENT_LOOKUP_SQL = 'SELECT id, name FROM clients WHERE id = ? AND user_email = ?';

const CLIENT_TOTALS_SQL = `SELECT COUNT(*) AS entryCount, COALESCE(SUM(hours), 0) AS totalHours
   FROM work_entries
   WHERE client_id = ? AND user_email = ?`;

const CLIENT_ENTRIES_SQL = `SELECT hours, description, date, created_at
   FROM work_entries 
   WHERE client_id = ? AND user_email = ? 
   ORDER BY date DESC`;

function reportFilename(client, extension) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${client.name.replace(/[^a-zA-Z0-9]/g, '_')}_report_${timestamp}.${extension}`;
}

// Quote a CSV field when it contains a comma, quote, CR or LF.
function csvField(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvLine(values) {
  return values.map(csvField).join(',') + '\n';
}

// Looks up the client (scoped to the user) and its SUM/COUNT totals, then
// invokes onReady(client, totals). Sends the standard error responses itself.
function loadClientWithTotals(db, clientId, userEmail, res, onReady) {
  db.get(CLIENT_LOOKUP_SQL, [clientId, userEmail], (err, client) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    db.get(CLIENT_TOTALS_SQL, [clientId, userEmail], (err, totals) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      onReady(client, {
        totalHours: Number(totals.totalHours) || 0,
        entryCount: Number(totals.entryCount) || 0
      });
    });
  });
}

// Get hourly report for specific client
router.get('/client/:clientId', (req, res) => {
  const clientId = parseInt(req.params.clientId);
  
  if (isNaN(clientId)) {
    return res.status(400).json({ error: 'Invalid client ID' });
  }
  
  const db = getDatabase();

  loadClientWithTotals(db, clientId, req.userEmail, res, (client, totals) => {
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

        res.json({
          client: client,
          workEntries: workEntries,
          totalHours: totals.totalHours,
          entryCount: totals.entryCount
        });
      }
    );
  });
});

// Export client report as CSV (streamed row by row)
router.get('/export/csv/:clientId', (req, res) => {
  const clientId = parseInt(req.params.clientId);
  
  if (isNaN(clientId)) {
    return res.status(400).json({ error: 'Invalid client ID' });
  }
  
  const db = getDatabase();
  
  db.get(CLIENT_LOOKUP_SQL, [clientId, req.userEmail], (err, client) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const filename = reportFilename(client, 'csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const headerLine = csvLine(['Date', 'Hours', 'Description', 'Created At']);
    let headerWritten = false;

    const writeHeader = () => {
      if (!headerWritten) {
        headerWritten = true;
        res.write(headerLine);
      }
    };

    db.each(
      CLIENT_ENTRIES_SQL,
      [clientId, req.userEmail],
      (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return;
        }
        writeHeader();
        res.write(csvLine([row.date, row.hours, row.description, row.created_at]));
      },
      (err) => {
        if (err) {
          console.error('Database error:', err);
          if (res.headersSent) {
            // Body already streaming; the only option is to terminate it.
            return res.end();
          }
          res.removeHeader('Content-Type');
          res.removeHeader('Content-Disposition');
          return res.status(500).json({ error: 'Internal server error' });
        }

        writeHeader();
        res.end();
      }
    );
  });
});

// Export client report as PDF (rows streamed into the piped document)
router.get('/export/pdf/:clientId', (req, res) => {
  const clientId = parseInt(req.params.clientId);
  
  if (isNaN(clientId)) {
    return res.status(400).json({ error: 'Invalid client ID' });
  }
  
  const db = getDatabase();

  loadClientWithTotals(db, clientId, req.userEmail, res, (client, totals) => {
    const doc = new PDFDocument();
    const filename = reportFilename(client, 'pdf');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    doc.pipe(res);

    doc.fontSize(20).text(`Time Report for ${client.name}`, { align: 'center' });
    doc.moveDown();

    doc.fontSize(14).text(`Total Hours: ${totals.totalHours.toFixed(2)}`);
    doc.text(`Total Entries: ${totals.entryCount}`);
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

    let index = 0;

    db.each(
      CLIENT_ENTRIES_SQL,
      [clientId, req.userEmail],
      (err, entry) => {
        if (err) {
          console.error('Database error:', err);
          return;
        }

        const y = doc.y;

        // Check if we need a new page
        if (y > 700) {
          doc.addPage();
        }

        doc.text(entry.date, 50, doc.y, { width: 100 });
        doc.text(entry.hours.toString(), 150, y, { width: 80 });
        doc.text(entry.description || 'No description', 230, y, { width: 300 });
        doc.moveDown();

        index += 1;

        // Add separator line every 5 entries
        if (index % 5 === 0) {
          doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
          doc.moveDown(0.5);
        }
      },
      (err) => {
        if (err) {
          console.error('Database error:', err);
          doc.text('Report truncated: an error occurred while reading work entries.');
        }
        doc.end();
      }
    );
  });
});

module.exports = router;
