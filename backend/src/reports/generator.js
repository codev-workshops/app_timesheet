/*
 * Deliberately duplicates the native report formatting in routes/reports.js.
 * Keeping this generator separate lets the asynchronous path evolve without
 * changing the existing synchronous endpoints.
 */
const { createObjectCsvStringifier } = require('csv-writer');
const PDFDocument = require('pdfkit');

function csvReport(data) {
  const csv = createObjectCsvStringifier({
    header: [
      { id: 'date', title: 'Date' },
      { id: 'hours', title: 'Hours' },
      { id: 'description', title: 'Description' },
      { id: 'created_at', title: 'Created At' }
    ]
  });
  return Buffer.from(csv.getHeaderString() + csv.stringifyRecords(data.workEntries));
}

function pdfReport(data, now = new Date()) {
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument();
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(20).text(`Time Report for ${data.client.name}`, { align: 'center' });
    doc.moveDown();
    const totalHours = data.workEntries.reduce((sum, entry) => sum + parseFloat(entry.hours), 0);
    doc.fontSize(14).text(`Total Hours: ${totalHours.toFixed(2)}`);
    doc.text(`Total Entries: ${data.workEntries.length}`);
    doc.text(`Generated: ${now.toLocaleString()}`);
    doc.moveDown();
    doc.fontSize(12).text('Date', 50, doc.y, { width: 100 });
    doc.text('Hours', 150, doc.y - 15, { width: 80 });
    doc.text('Description', 230, doc.y - 15, { width: 300 });
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);
    data.workEntries.forEach((entry, index) => {
      const y = doc.y;
      if (y > 700) doc.addPage();
      doc.text(entry.date, 50, doc.y, { width: 100 });
      doc.text(entry.hours.toString(), 150, y, { width: 80 });
      doc.text(entry.description || 'No description', 230, y, { width: 300 });
      doc.moveDown();
      if ((index + 1) % 5 === 0) {
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);
      }
    });
    doc.end();
  });
}

async function generate(format, data, now) {
  return format === 'csv' ? csvReport(data) : pdfReport(data, now);
}

module.exports = { generate, csvReport, pdfReport };
