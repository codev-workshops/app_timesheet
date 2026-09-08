const request = require('supertest');
const express = require('express');
const workEntryRoutes = require('../../routes/workEntries');
const { getDatabase } = require('../../database/init');
const { expectDbCall, silenceConsoleError } = require('./helpers');

jest.mock('../../database/init');
jest.mock('../../middleware/auth', () => ({
  authenticateUser: (req, res, next) => {
    req.userEmail = 'test@example.com';
    next();
  }
}));

const app = express();
app.use(express.json());
app.use('/api/work-entries', workEntryRoutes);
app.use((err, req, res, next) => {
  if (err.isJoi) {
    return res.status(400).json({ error: 'Validation error' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

const USER = 'test@example.com';
const SELECT_ENTRY_WITH_CLIENT = `
  SELECT we.id, we.client_id, we.hours, we.description, we.date,
         we.created_at, we.updated_at, c.name as client_name
  FROM work_entries we
  JOIN clients c ON we.client_id = c.id`;

describe('Work Entry Routes - query and parameter contracts', () => {
  let mockDb;
  let consoleError;

  beforeEach(() => {
    mockDb = { all: jest.fn(), get: jest.fn(), run: jest.fn() };
    getDatabase.mockReturnValue(mockDb);
    consoleError = silenceConsoleError();
  });

  afterEach(() => {
    consoleError.mockRestore();
    jest.clearAllMocks();
  });

  const runOk = () => {
    mockDb.run.mockImplementation(function (query, params, cb) {
      this.lastID = 99;
      cb.call(this, null);
    });
  };

  describe('GET /api/work-entries', () => {
    test('uses exact user-scoped query ordered by date then created_at', async () => {
      mockDb.all.mockImplementation((q, p, cb) => cb(null, []));
      await request(app).get('/api/work-entries');
      expectDbCall(
        mockDb.all,
        0,
        `${SELECT_ENTRY_WITH_CLIENT} WHERE we.user_email = ? ORDER BY we.date DESC, we.created_at DESC`,
        [USER]
      );
    });

    test('appends client filter before ORDER BY', async () => {
      mockDb.all.mockImplementation((q, p, cb) => cb(null, []));
      await request(app).get('/api/work-entries?clientId=4');
      expectDbCall(
        mockDb.all,
        0,
        `${SELECT_ENTRY_WITH_CLIENT} WHERE we.user_email = ? AND we.client_id = ? ORDER BY we.date DESC, we.created_at DESC`,
        [USER, 4]
      );
    });

    test('logs database errors with a descriptive prefix', async () => {
      const err = new Error('boom');
      mockDb.all.mockImplementation((q, p, cb) => cb(err));
      await request(app).get('/api/work-entries');
      expect(consoleError).toHaveBeenCalledWith('Database error:', err);
    });
  });

  describe('GET /api/work-entries/:id', () => {
    test('uses exact id + user scoped query', async () => {
      mockDb.get.mockImplementation((q, p, cb) => cb(null, { id: 3 }));
      await request(app).get('/api/work-entries/3');
      expectDbCall(mockDb.get, 0, `${SELECT_ENTRY_WITH_CLIENT} WHERE we.id = ? AND we.user_email = ?`, [3, USER]);
    });

    test('logs database errors with a descriptive prefix', async () => {
      const err = new Error('boom');
      mockDb.get.mockImplementation((q, p, cb) => cb(err));
      await request(app).get('/api/work-entries/3');
      expect(consoleError).toHaveBeenCalledWith('Database error:', err);
    });
  });

  describe('POST /api/work-entries', () => {
    const body = { clientId: 2, hours: 4.5, description: 'Work', date: '2024-01-15' };

    test('verifies client, inserts entry, and re-selects by lastID', async () => {
      mockDb.get
        .mockImplementationOnce((q, p, cb) => cb(null, { id: 2 }))
        .mockImplementationOnce((q, p, cb) => cb(null, { id: 99 }));
      runOk();

      const res = await request(app).post('/api/work-entries').send(body);

      expect(res.status).toBe(201);
      expectDbCall(mockDb.get, 0, 'SELECT id FROM clients WHERE id = ? AND user_email = ?', [2, USER]);
      expectDbCall(
        mockDb.run,
        0,
        'INSERT INTO work_entries (client_id, user_email, hours, description, date) VALUES (?, ?, ?, ?, ?)',
        [2, USER, 4.5, 'Work', new Date('2024-01-15')]
      );
      expectDbCall(mockDb.get, 1, `${SELECT_ENTRY_WITH_CLIENT} WHERE we.id = ?`, [99]);
    });

    test('stores null description when empty or omitted', async () => {
      mockDb.get.mockImplementation((q, p, cb) => cb(null, { id: 2 }));
      runOk();

      await request(app).post('/api/work-entries').send({ ...body, description: '' });
      expect(mockDb.run.mock.calls[0][1][3]).toBeNull();

      const { description, ...noDesc } = body;
      await request(app).post('/api/work-entries').send(noDesc);
      expect(mockDb.run.mock.calls[1][1][3]).toBeNull();
    });

    test('logs client-check, insert and re-select errors with a descriptive prefix', async () => {
      const e1 = new Error('client');
      mockDb.get.mockImplementationOnce((q, p, cb) => cb(e1));
      await request(app).post('/api/work-entries').send(body);
      expect(consoleError).toHaveBeenCalledWith('Database error:', e1);

      consoleError.mockClear();
      const e2 = new Error('insert');
      mockDb.get.mockImplementationOnce((q, p, cb) => cb(null, { id: 2 }));
      mockDb.run.mockImplementation((q, p, cb) => cb(e2));
      await request(app).post('/api/work-entries').send(body);
      expect(consoleError).toHaveBeenCalledWith('Database error:', e2);

      consoleError.mockClear();
      const e3 = new Error('reselect');
      mockDb.get
        .mockImplementationOnce((q, p, cb) => cb(null, { id: 2 }))
        .mockImplementationOnce((q, p, cb) => cb(e3));
      runOk();
      await request(app).post('/api/work-entries').send(body);
      expect(consoleError).toHaveBeenCalledWith('Database error:', e3);
    });
  });

  describe('PUT /api/work-entries/:id', () => {
    const UPDATE_TAIL = ', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_email = ?';

    const putWithoutClient = async (body) => {
      mockDb.get
        .mockImplementationOnce((q, p, cb) => cb(null, { id: 1 }))
        .mockImplementationOnce((q, p, cb) => cb(null, { id: 1 }));
      runOk();
      const res = await request(app).put('/api/work-entries/1').send(body);
      return { res, run: mockDb.run.mock.calls[0] };
    };

    test('checks existence with exact id + user scoped query', async () => {
      await putWithoutClient({ hours: 2 });
      expectDbCall(mockDb.get, 0, 'SELECT id FROM work_entries WHERE id = ? AND user_email = ?', [1, USER]);
    });

    test('builds update for hours only', async () => {
      const { run } = await putWithoutClient({ hours: 2 });
      expect(run[0]).toBe(`UPDATE work_entries SET hours = ?${UPDATE_TAIL}`);
      expect(run[1]).toEqual([2, 1, USER]);
    });

    test('builds update for description only, mapping empty string to null', async () => {
      const { run } = await putWithoutClient({ description: '' });
      expect(run[0]).toBe(`UPDATE work_entries SET description = ?${UPDATE_TAIL}`);
      expect(run[1]).toEqual([null, 1, USER]);
    });

    test('builds update for date only', async () => {
      const { run } = await putWithoutClient({ date: '2024-02-01' });
      expect(run[0]).toBe(`UPDATE work_entries SET date = ?${UPDATE_TAIL}`);
      expect(run[1]).toEqual([new Date('2024-02-01'), 1, USER]);
    });

    test('verifies new client then builds update for all fields in declaration order', async () => {
      mockDb.get
        .mockImplementationOnce((q, p, cb) => cb(null, { id: 1 }))
        .mockImplementationOnce((q, p, cb) => cb(null, { id: 7 }))
        .mockImplementationOnce((q, p, cb) => cb(null, { id: 1 }));
      runOk();

      const res = await request(app)
        .put('/api/work-entries/1')
        .send({ clientId: 7, hours: 3, description: 'D', date: '2024-03-01' });

      expect(res.status).toBe(200);
      expectDbCall(mockDb.get, 1, 'SELECT id FROM clients WHERE id = ? AND user_email = ?', [7, USER]);
      const run = mockDb.run.mock.calls[0];
      expect(run[0]).toBe(`UPDATE work_entries SET client_id = ?, hours = ?, description = ?, date = ?${UPDATE_TAIL}`);
      expect(run[1]).toEqual([7, 3, 'D', new Date('2024-03-01'), 1, USER]);
      expectDbCall(mockDb.get, 2, `${SELECT_ENTRY_WITH_CLIENT} WHERE we.id = ?`, [1]);
    });

    test('logs existence, client-check, update and re-select errors with a descriptive prefix', async () => {
      const e1 = new Error('exists');
      mockDb.get.mockImplementationOnce((q, p, cb) => cb(e1));
      await request(app).put('/api/work-entries/1').send({ hours: 2 });
      expect(consoleError).toHaveBeenCalledWith('Database error:', e1);

      consoleError.mockClear();
      const e2 = new Error('client');
      mockDb.get
        .mockImplementationOnce((q, p, cb) => cb(null, { id: 1 }))
        .mockImplementationOnce((q, p, cb) => cb(e2));
      await request(app).put('/api/work-entries/1').send({ clientId: 7 });
      expect(consoleError).toHaveBeenCalledWith('Database error:', e2);

      consoleError.mockClear();
      const e3 = new Error('update');
      mockDb.get.mockImplementationOnce((q, p, cb) => cb(null, { id: 1 }));
      mockDb.run.mockImplementation((q, p, cb) => cb(e3));
      await request(app).put('/api/work-entries/1').send({ hours: 2 });
      expect(consoleError).toHaveBeenCalledWith('Database error:', e3);

      consoleError.mockClear();
      const e4 = new Error('reselect');
      mockDb.get
        .mockImplementationOnce((q, p, cb) => cb(null, { id: 1 }))
        .mockImplementationOnce((q, p, cb) => cb(e4));
      runOk();
      await request(app).put('/api/work-entries/1').send({ hours: 2 });
      expect(consoleError).toHaveBeenCalledWith('Database error:', e4);
    });
  });

  describe('DELETE /api/work-entries/:id', () => {
    test('checks existence then deletes with exact scoped queries', async () => {
      mockDb.get.mockImplementation((q, p, cb) => cb(null, { id: 5 }));
      runOk();
      await request(app).delete('/api/work-entries/5');
      expectDbCall(mockDb.get, 0, 'SELECT id FROM work_entries WHERE id = ? AND user_email = ?', [5, USER]);
      expectDbCall(mockDb.run, 0, 'DELETE FROM work_entries WHERE id = ? AND user_email = ?', [5, USER]);
    });

    test('logs existence-check and delete errors with a descriptive prefix', async () => {
      const e1 = new Error('exists');
      mockDb.get.mockImplementation((q, p, cb) => cb(e1));
      await request(app).delete('/api/work-entries/5');
      expect(consoleError).toHaveBeenCalledWith('Database error:', e1);

      consoleError.mockClear();
      const e2 = new Error('delete');
      mockDb.get.mockImplementation((q, p, cb) => cb(null, { id: 5 }));
      mockDb.run.mockImplementation((q, p, cb) => cb(e2));
      await request(app).delete('/api/work-entries/5');
      expect(consoleError).toHaveBeenCalledWith('Database error:', e2);
    });
  });
});
