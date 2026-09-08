const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDatabase } = require('../../database/init');
const { expectDbCall, silenceConsoleError } = require('./helpers');

jest.mock('../../database/init');
jest.mock('../../middleware/auth', () => ({
  authenticateUser: (req, res, next) => {
    req.userEmail = 'test@example.com';
    next();
  }
}));

const mockWriteRecords = jest.fn().mockResolvedValue(undefined);
jest.mock('csv-writer', () => ({
  createObjectCsvWriter: jest.fn(() => ({ writeRecords: mockWriteRecords }))
}));

// PDF mock that actually ends the piped response so requests complete.
const mockPdfDocs = [];
const mockMakePdfDoc = (y = 100) => {
  const doc = {
    y,
    fontSize: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    moveDown: jest.fn().mockReturnThis(),
    moveTo: jest.fn().mockReturnThis(),
    lineTo: jest.fn().mockReturnThis(),
    stroke: jest.fn().mockReturnThis(),
    addPage: jest.fn().mockReturnThis(),
    pipe: jest.fn(function (res) {
      this._res = res;
    }),
    end: jest.fn(function () {
      this._res.end();
    })
  };
  mockPdfDocs.push(doc);
  return doc;
};
jest.mock('pdfkit', () => jest.fn().mockImplementation(() => mockMakePdfDoc()));

const { createObjectCsvWriter } = require('csv-writer');
const reportRoutes = require('../../routes/reports');

const USER = 'test@example.com';
const downloadCalls = [];
let downloadError = null;

const app = express();
app.use(express.json());
// Stub res.download so the flow can be observed without writing real files.
app.use((req, res, next) => {
  res.download = (filePath, filename, cb) => {
    downloadCalls.push({ filePath, filename });
    if (downloadError) {
      cb(downloadError);
      return res.status(500).end();
    }
    res.status(200).end();
    cb();
  };
  next();
});
app.use('/api/reports', reportRoutes);

const ENTRIES_QUERY = (cols) => `SELECT ${cols} FROM work_entries WHERE client_id = ? AND user_email = ? ORDER BY date DESC`;

describe('Report Routes - query contracts and export behaviour', () => {
  let mockDb;
  let consoleError;
  let existsSync;
  let mkdirSync;
  let unlink;

  beforeEach(() => {
    mockDb = { all: jest.fn(), get: jest.fn() };
    getDatabase.mockReturnValue(mockDb);
    consoleError = silenceConsoleError();
    existsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    mkdirSync = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    unlink = jest.spyOn(fs, 'unlink').mockImplementation((p, cb) => cb(null));
    downloadCalls.length = 0;
    downloadError = null;
    mockPdfDocs.length = 0;
    mockWriteRecords.mockClear();
    mockWriteRecords.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
    existsSync.mockRestore();
    mkdirSync.mockRestore();
    unlink.mockRestore();
    jest.clearAllMocks();
  });

  const clientFound = (name = 'Test Client') => {
    mockDb.get.mockImplementation((q, p, cb) => cb(null, { id: 1, name }));
  };
  const entries = (rows) => {
    mockDb.all.mockImplementation((q, p, cb) => cb(null, rows));
  };

  describe('GET /api/reports/client/:clientId', () => {
    test('uses exact client lookup and entries queries', async () => {
      clientFound();
      entries([]);
      await request(app).get('/api/reports/client/1');
      expectDbCall(mockDb.get, 0, 'SELECT id, name FROM clients WHERE id = ? AND user_email = ?', [1, USER]);
      expectDbCall(mockDb.all, 0, ENTRIES_QUERY('id, hours, description, date, created_at, updated_at'), [1, USER]);
    });

    test('logs client and entries errors with a descriptive prefix', async () => {
      const e1 = new Error('client');
      mockDb.get.mockImplementation((q, p, cb) => cb(e1));
      await request(app).get('/api/reports/client/1');
      expect(consoleError).toHaveBeenCalledWith('Database error:', e1);

      consoleError.mockClear();
      const e2 = new Error('entries');
      clientFound();
      mockDb.all.mockImplementation((q, p, cb) => cb(e2));
      await request(app).get('/api/reports/client/1');
      expect(consoleError).toHaveBeenCalledWith('Database error:', e2);
    });
  });

  describe('GET /api/reports/export/csv/:clientId', () => {
    const rows = [{ date: '2024-01-01', hours: 5, description: 'W', created_at: '2024-01-01' }];

    test('uses exact entries query', async () => {
      clientFound();
      entries(rows);
      await request(app).get('/api/reports/export/csv/1');
      expectDbCall(mockDb.all, 0, ENTRIES_QUERY('hours, description, date, created_at'), [1, USER]);
    });

    test('writes CSV with the expected header, sanitized filename and temp path, then downloads and cleans up', async () => {
      clientFound('Acme & Co.');
      entries(rows);

      const res = await request(app).get('/api/reports/export/csv/1');

      expect(res.status).toBe(200);
      expect(createObjectCsvWriter).toHaveBeenCalledTimes(1);
      const opts = createObjectCsvWriter.mock.calls[0][0];
      expect(opts.header).toEqual([
        { id: 'date', title: 'Date' },
        { id: 'hours', title: 'Hours' },
        { id: 'description', title: 'Description' },
        { id: 'created_at', title: 'Created At' }
      ]);
      expect(mockWriteRecords).toHaveBeenCalledWith(rows);

      expect(downloadCalls).toHaveLength(1);
      const { filePath, filename } = downloadCalls[0];
      expect(filename).toMatch(/^Acme___Co__report_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.csv$/);
      expect(filePath).toBe(opts.path);
      expect(path.dirname(filePath)).toBe(path.resolve(__dirname, '../../../temp'));
      expect(path.basename(filePath)).toBe(filename);

      expect(unlink).toHaveBeenCalledWith(filePath, expect.any(Function));
      expect(consoleError).not.toHaveBeenCalled();
    });

    test('creates the temp directory when missing, using the temp dir path', async () => {
      clientFound();
      entries(rows);
      existsSync.mockReturnValue(false);
      await request(app).get('/api/reports/export/csv/1');
      expect(mkdirSync).toHaveBeenCalledWith(path.resolve(__dirname, '../../../temp'), { recursive: true });
    });

    test('logs download errors and still removes the temp file', async () => {
      clientFound();
      entries(rows);
      downloadError = new Error('send failed');
      await request(app).get('/api/reports/export/csv/1');
      expect(consoleError).toHaveBeenCalledWith('Error sending file:', downloadError);
      expect(unlink).toHaveBeenCalledTimes(1);
    });

    test('logs temp file deletion errors', async () => {
      clientFound();
      entries(rows);
      const unlinkErr = new Error('unlink failed');
      unlink.mockImplementation((p, cb) => cb(unlinkErr));
      await request(app).get('/api/reports/export/csv/1');
      expect(consoleError).toHaveBeenCalledWith('Error deleting temp file:', unlinkErr);
    });

    test('logs CSV creation and database errors with descriptive prefixes', async () => {
      clientFound();
      entries(rows);
      const csvErr = new Error('csv');
      mockWriteRecords.mockRejectedValue(csvErr);
      await request(app).get('/api/reports/export/csv/1');
      expect(consoleError).toHaveBeenCalledWith('Error creating CSV:', csvErr);

      consoleError.mockClear();
      const e1 = new Error('client');
      mockDb.get.mockImplementation((q, p, cb) => cb(e1));
      await request(app).get('/api/reports/export/csv/1');
      expect(consoleError).toHaveBeenCalledWith('Database error:', e1);

      consoleError.mockClear();
      const e2 = new Error('entries');
      clientFound();
      mockDb.all.mockImplementation((q, p, cb) => cb(e2));
      await request(app).get('/api/reports/export/csv/1');
      expect(consoleError).toHaveBeenCalledWith('Database error:', e2);
    });
  });

  describe('GET /api/reports/export/pdf/:clientId', () => {
    const rows = [
      { date: '2024-01-01', hours: 5.25, description: 'First', created_at: '2024-01-01' },
      { date: '2024-01-02', hours: 7.25, description: null, created_at: '2024-01-02' }
    ];

    test('uses exact entries query', async () => {
      clientFound();
      entries(rows);
      await request(app).get('/api/reports/export/pdf/1');
      expectDbCall(mockDb.all, 0, ENTRIES_QUERY('hours, description, date, created_at'), [1, USER]);
    });

    test('sets PDF headers with sanitized filename and pipes document to response', async () => {
      clientFound('Acme & Co.');
      entries(rows);

      const res = await request(app).get('/api/reports/export/pdf/1');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="Acme___Co__report_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.pdf"$/
      );
      const doc = mockPdfDocs[0];
      expect(doc.pipe).toHaveBeenCalledTimes(1);
      expect(doc.end).toHaveBeenCalledTimes(1);
    });

    test('renders title, totals, table header and entry rows', async () => {
      clientFound('Acme');
      entries(rows);
      await request(app).get('/api/reports/export/pdf/1');
      const doc = mockPdfDocs[0];

      expect(doc.fontSize).toHaveBeenNthCalledWith(1, 20);
      expect(doc.text).toHaveBeenNthCalledWith(1, 'Time Report for Acme', { align: 'center' });
      expect(doc.fontSize).toHaveBeenNthCalledWith(2, 14);
      expect(doc.text).toHaveBeenNthCalledWith(2, 'Total Hours: 12.50');
      expect(doc.text).toHaveBeenNthCalledWith(3, 'Total Entries: 2');
      expect(doc.text).toHaveBeenNthCalledWith(4, expect.stringMatching(/^Generated: .+/));

      expect(doc.fontSize).toHaveBeenNthCalledWith(3, 12);
      expect(doc.text).toHaveBeenNthCalledWith(5, 'Date', 50, 100, { width: 100 });
      expect(doc.text).toHaveBeenNthCalledWith(6, 'Hours', 150, 85, { width: 80 });
      expect(doc.text).toHaveBeenNthCalledWith(7, 'Description', 230, 85, { width: 300 });

      expect(doc.moveTo).toHaveBeenNthCalledWith(1, 50, 100);
      expect(doc.lineTo).toHaveBeenNthCalledWith(1, 550, 100);
      expect(doc.stroke).toHaveBeenCalledTimes(1);
      expect(doc.moveDown).toHaveBeenCalledWith(0.5);

      expect(doc.text).toHaveBeenNthCalledWith(8, '2024-01-01', 50, 100, { width: 100 });
      expect(doc.text).toHaveBeenNthCalledWith(9, '5.25', 150, 100, { width: 80 });
      expect(doc.text).toHaveBeenNthCalledWith(10, 'First', 230, 100, { width: 300 });
      expect(doc.text).toHaveBeenNthCalledWith(11, '2024-01-02', 50, 100, { width: 100 });
      expect(doc.text).toHaveBeenNthCalledWith(12, '7.25', 150, 100, { width: 80 });
      expect(doc.text).toHaveBeenNthCalledWith(13, 'No description', 230, 100, { width: 300 });
      expect(doc.addPage).not.toHaveBeenCalled();
      expect(doc.moveDown).toHaveBeenCalledTimes(3 + 1 + rows.length);
    });

    test('draws a separator after every 5th entry only', async () => {
      clientFound();
      entries(Array.from({ length: 10 }, (_, i) => ({ date: `2024-01-${String(i + 1).padStart(2, '0')}`, hours: 1, description: 'x', created_at: 'c' })));
      await request(app).get('/api/reports/export/pdf/1');
      const doc = mockPdfDocs[0];
      // one header rule + two separators (after entries 5 and 10)
      expect(doc.stroke).toHaveBeenCalledTimes(3);
      expect(doc.moveDown.mock.calls.filter((c) => c[0] === 0.5)).toHaveLength(3);
    });

    test('does not draw a separator for 4 entries', async () => {
      clientFound();
      entries(Array.from({ length: 4 }, () => ({ date: 'd', hours: 1, description: 'x', created_at: 'c' })));
      await request(app).get('/api/reports/export/pdf/1');
      expect(mockPdfDocs[0].stroke).toHaveBeenCalledTimes(1);
    });

    test('adds a new page only when the cursor is strictly below 700', async () => {
      clientFound();
      entries([{ date: 'd', hours: 1, description: 'x', created_at: 'c' }]);
      const PDFDocument = require('pdfkit');

      PDFDocument.mockImplementationOnce(() => mockMakePdfDoc(701));
      await request(app).get('/api/reports/export/pdf/1');
      expect(mockPdfDocs[0].addPage).toHaveBeenCalledTimes(1);

      mockPdfDocs.length = 0;
      PDFDocument.mockImplementationOnce(() => mockMakePdfDoc(700));
      await request(app).get('/api/reports/export/pdf/1');
      expect(mockPdfDocs[0].addPage).not.toHaveBeenCalled();
    });

    test('logs client and entries errors with a descriptive prefix', async () => {
      const e1 = new Error('client');
      mockDb.get.mockImplementation((q, p, cb) => cb(e1));
      await request(app).get('/api/reports/export/pdf/1');
      expect(consoleError).toHaveBeenCalledWith('Database error:', e1);

      consoleError.mockClear();
      const e2 = new Error('entries');
      clientFound();
      mockDb.all.mockImplementation((q, p, cb) => cb(e2));
      const res = await request(app).get('/api/reports/export/pdf/1');
      expect(res.status).toBe(500);
      expect(consoleError).toHaveBeenCalledWith('Database error:', e2);
    });
  });
});
