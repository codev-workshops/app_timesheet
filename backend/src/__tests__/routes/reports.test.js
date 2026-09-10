const request = require('supertest');
const express = require('express');
const { getDatabase } = require('../../database/init');

jest.mock('../../database/init');
jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => ({
    fontSize: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    moveDown: jest.fn().mockReturnThis(),
    moveTo: jest.fn().mockReturnThis(),
    lineTo: jest.fn().mockReturnThis(),
    stroke: jest.fn().mockReturnThis(),
    addPage: jest.fn().mockReturnThis(),
    pipe: jest.fn(function (dest) { this.dest = dest; }),
    end: jest.fn(function () { if (this.dest) this.dest.end(); }),
    y: 100
  }));
});

const reportRoutes = require('../../routes/reports');
jest.mock('../../middleware/auth', () => ({
  authenticateUser: (req, res, next) => {
    req.userEmail = 'test@example.com';
    next();
  }
}));

const app = express();
app.use(express.json());
app.use('/api/reports', reportRoutes);

describe('Report Routes', () => {
  let mockDb;

  const isTotalsQuery = (query) => query.includes('COUNT(*)');

  // db.get answers the client lookup with `client` and the SUM/COUNT aggregate
  // with totals derived from `entries`.
  const mockClientAndTotals = (client, entries) => {
    mockDb.get.mockImplementation((query, params, callback) => {
      if (isTotalsQuery(query)) {
        const totalHours = entries.reduce((sum, e) => sum + parseFloat(e.hours), 0);
        return callback(null, { entryCount: entries.length, totalHours });
      }
      callback(null, client);
    });
  };

  // db.each emits each entry then the completion callback.
  const mockEachRows = (entries) => {
    mockDb.each.mockImplementation((query, params, onRow, onComplete) => {
      entries.forEach((row) => onRow(null, row));
      onComplete(null, entries.length);
    });
  };

  beforeEach(() => {
    mockDb = {
      all: jest.fn(),
      get: jest.fn(),
      each: jest.fn()
    };
    getDatabase.mockReturnValue(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/reports/client/:clientId', () => {
    test('should return client report with work entries', async () => {
      const mockClient = { id: 1, name: 'Test Client' };
      const mockWorkEntries = [
        { id: 1, hours: 5.5, description: 'Work 1', date: '2024-01-01' },
        { id: 2, hours: 3.0, description: 'Work 2', date: '2024-01-02' }
      ];

      mockClientAndTotals(mockClient, mockWorkEntries);

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, mockWorkEntries);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.status).toBe(200);
      expect(response.body.client).toEqual(mockClient);
      expect(response.body.workEntries).toEqual(mockWorkEntries);
      expect(response.body.totalHours).toBe(8.5);
      expect(response.body.entryCount).toBe(2);
    });

    test('should return report with zero hours for client with no entries', async () => {
      const mockClient = { id: 1, name: 'Empty Client' };

      mockClientAndTotals(mockClient, []);

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.status).toBe(200);
      expect(response.body.totalHours).toBe(0);
      expect(response.body.entryCount).toBe(0);
    });

    test('should return 404 if client not found', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const response = await request(app).get('/api/reports/client/999');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Client not found' });
    });

    test('should return 400 for invalid client ID', async () => {
      const response = await request(app).get('/api/reports/client/invalid');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid client ID' });
    });

    test('should handle database error when fetching client', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });

    test('should handle database error when fetching work entries', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });

    test('should filter work entries by user email', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        expect(params).toEqual([1, 'test@example.com']);
        callback(null, []);
      });

      await request(app).get('/api/reports/client/1');

      expect(mockDb.all).toHaveBeenCalledWith(
        expect.stringContaining('WHERE client_id = ? AND user_email = ?'),
        [1, 'test@example.com'],
        expect.any(Function)
      );
    });
  });

  describe('GET /api/reports/export/csv/:clientId', () => {
    test('should return 400 for invalid client ID', async () => {
      const response = await request(app).get('/api/reports/export/csv/invalid');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid client ID' });
    });

    test('should return 404 if client not found', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const response = await request(app).get('/api/reports/export/csv/999');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Client not found' });
    });

    test('should handle database error when fetching client', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });

    test('should handle database error when fetching work entries', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.each.mockImplementation((query, params, onRow, onComplete) => {
        onComplete(new Error('Database error'));
      });

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  describe('GET /api/reports/export/pdf/:clientId', () => {
    test('should return 400 for invalid client ID', async () => {
      const response = await request(app).get('/api/reports/export/pdf/invalid');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid client ID' });
    });

    test('should return 404 if client not found', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const response = await request(app).get('/api/reports/export/pdf/999');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Client not found' });
    });

    test('should handle database error', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  describe('Data Isolation', () => {
    test('should only return data for authenticated user', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        expect(params).toContain('test@example.com');
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        expect(params).toContain('test@example.com');
        callback(null, []);
      });

      await request(app).get('/api/reports/client/1');

      expect(mockDb.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['test@example.com']),
        expect.any(Function)
      );
    });
  });

  describe('Hours Calculation', () => {
    test('should correctly sum decimal hours', async () => {
      const entries = [{ hours: 2.5 }, { hours: 3.75 }, { hours: 1.25 }];
      mockClientAndTotals({ id: 1, name: 'Test Client' }, entries);

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, entries);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.body.totalHours).toBe(7.5);
      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('SUM(hours)'),
        [1, 'test@example.com'],
        expect.any(Function)
      );
    });

    test('should handle integer hours', async () => {
      const entries = [{ hours: 8 }, { hours: 4 }];
      mockClientAndTotals({ id: 1, name: 'Test Client' }, entries);

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, entries);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.body.totalHours).toBe(12);
    });
  });

  describe('CSV Export Streaming', () => {
    const mockClient = { id: 1, name: 'Test Client' };

    test('should stream CSV with headers, content-type and attachment disposition', async () => {
      const entries = [
        { date: '2024-01-02', hours: 5, description: 'Work 1', created_at: '2024-01-02 10:00:00' },
        { date: '2024-01-01', hours: 2.5, description: null, created_at: '2024-01-01 10:00:00' }
      ];
      mockDb.get.mockImplementation((query, params, callback) => callback(null, mockClient));
      mockEachRows(entries);

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/csv/);
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="Test_Client_report_.*\.csv"$/);
      expect(response.text).toBe(
        'Date,Hours,Description,Created At\n' +
        '2024-01-02,5,Work 1,2024-01-02 10:00:00\n' +
        '2024-01-01,2.5,,2024-01-01 10:00:00\n'
      );
      expect(mockDb.all).not.toHaveBeenCalled();
    });

    test('should escape fields containing commas, quotes and newlines', async () => {
      const entries = [
        { date: '2024-01-01', hours: 1, description: 'Fix "urgent" bug, then\nredeploy', created_at: 'c' }
      ];
      mockDb.get.mockImplementation((query, params, callback) => callback(null, mockClient));
      mockEachRows(entries);

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.text).toBe(
        'Date,Hours,Description,Created At\n' +
        '2024-01-01,1,"Fix ""urgent"" bug, then\nredeploy",c\n'
      );
    });

    test('should emit only the header row for a client with no entries', async () => {
      mockDb.get.mockImplementation((query, params, callback) => callback(null, mockClient));
      mockEachRows([]);

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(200);
      expect(response.text).toBe('Date,Hours,Description,Created At\n');
    });

    test('should end the stream when the database fails mid-stream', async () => {
      mockDb.get.mockImplementation((query, params, callback) => callback(null, mockClient));
      mockDb.each.mockImplementation((query, params, onRow, onComplete) => {
        onRow(null, { date: '2024-01-01', hours: 1, description: 'ok', created_at: 'c' });
        onComplete(new Error('Disk I/O error'));
      });

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/csv/);
      expect(response.text).toBe('Date,Hours,Description,Created At\n2024-01-01,1,ok,c\n');
    });

    test('should verify CSV export calls correct database queries', async () => {
      mockDb.get.mockImplementation((query, params, callback) => callback(null, mockClient));
      mockEachRows([]);

      await request(app).get('/api/reports/export/csv/1');

      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, name FROM clients'),
        expect.arrayContaining([1, 'test@example.com']),
        expect.any(Function)
      );
      expect(mockDb.each).toHaveBeenCalledWith(
        expect.stringContaining('WHERE client_id = ? AND user_email = ?'),
        [1, 'test@example.com'],
        expect.any(Function),
        expect.any(Function)
      );
    });
  });

  describe('PDF Export Streaming', () => {
    test('should handle database error when fetching totals for PDF', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        if (isTotalsQuery(query)) {
          return callback(new Error('Database error'), null);
        }
        callback(null, { id: 1, name: 'Test Client' });
      });

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });

    test('should stream rows into the PDF via db.each and finalize the document', async () => {
      const PDFDocument = require('pdfkit');
      const entries = [
        { date: '2024-01-01', hours: 5, description: 'Work 1', created_at: 'c' },
        { date: '2024-01-02', hours: 3, description: null, created_at: 'c' }
      ];
      mockClientAndTotals({ id: 1, name: 'Test Client' }, entries);
      mockEachRows(entries);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="Test_Client_report_.*\.pdf"$/);

      const doc = PDFDocument.mock.results[PDFDocument.mock.results.length - 1].value;
      expect(doc.pipe).toHaveBeenCalled();
      expect(doc.text).toHaveBeenCalledWith('Total Hours: 8.00');
      expect(doc.text).toHaveBeenCalledWith('Total Entries: 2');
      expect(doc.text).toHaveBeenCalledWith('No description', 230, 100, { width: 300 });
      expect(doc.end).toHaveBeenCalledTimes(1);
      expect(mockDb.all).not.toHaveBeenCalled();
    });

    test('should verify PDF export calls correct database queries', async () => {
      mockClientAndTotals({ id: 1, name: 'Test Client' }, []);
      mockEachRows([]);

      await request(app).get('/api/reports/export/pdf/1');

      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, name FROM clients'),
        expect.arrayContaining([1, 'test@example.com']),
        expect.any(Function)
      );
      expect(mockDb.each).toHaveBeenCalledWith(
        expect.stringContaining('WHERE client_id = ? AND user_email = ?'),
        [1, 'test@example.com'],
        expect.any(Function),
        expect.any(Function)
      );
    });
  });
});
