const request = require('supertest');
const express = require('express');
const clientRoutes = require('../../routes/clients');
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
app.use('/api/clients', clientRoutes);
app.use((err, req, res, next) => {
  if (err.isJoi) {
    return res.status(400).json({ error: 'Validation error' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

const USER = 'test@example.com';
const SELECT_CLIENT_COLUMNS = 'SELECT id, name, description, department, email, created_at, updated_at FROM clients';

describe('Client Routes - query and parameter contracts', () => {
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

  const clientExists = () => {
    mockDb.get.mockImplementationOnce((query, params, cb) => cb(null, { id: 1 }));
  };
  const runOk = () => {
    mockDb.run.mockImplementation(function (query, params, cb) {
      this.lastID = 42;
      this.changes = 3;
      cb.call(this, null);
    });
  };

  describe('GET /api/clients', () => {
    test('uses exact user-scoped, name-ordered query', async () => {
      mockDb.all.mockImplementation((q, p, cb) => cb(null, []));
      await request(app).get('/api/clients');
      expectDbCall(mockDb.all, 0, `${SELECT_CLIENT_COLUMNS} WHERE user_email = ? ORDER BY name`, [USER]);
    });

    test('logs database errors with a descriptive prefix', async () => {
      const err = new Error('boom');
      mockDb.all.mockImplementation((q, p, cb) => cb(err));
      await request(app).get('/api/clients');
      expect(consoleError).toHaveBeenCalledWith('Database error:', err);
    });
  });

  describe('GET /api/clients/:id', () => {
    test('uses exact id + user scoped query', async () => {
      mockDb.get.mockImplementation((q, p, cb) => cb(null, { id: 7 }));
      await request(app).get('/api/clients/7');
      expectDbCall(mockDb.get, 0, `${SELECT_CLIENT_COLUMNS} WHERE id = ? AND user_email = ?`, [7, USER]);
    });

    test('logs database errors with a descriptive prefix', async () => {
      const err = new Error('boom');
      mockDb.get.mockImplementation((q, p, cb) => cb(err));
      await request(app).get('/api/clients/7');
      expect(consoleError).toHaveBeenCalledWith('Database error:', err);
    });
  });

  describe('POST /api/clients', () => {
    test('inserts all provided fields and re-selects by lastID', async () => {
      runOk();
      mockDb.get.mockImplementation((q, p, cb) => cb(null, { id: 42 }));

      const res = await request(app)
        .post('/api/clients')
        .send({ name: 'Acme', description: 'Desc', department: 'Eng', email: 'a@b.com' });

      expect(res.status).toBe(201);
      expectDbCall(
        mockDb.run,
        0,
        'INSERT INTO clients (name, description, department, email, user_email) VALUES (?, ?, ?, ?, ?)',
        ['Acme', 'Desc', 'Eng', 'a@b.com', USER]
      );
      expectDbCall(mockDb.get, 0, `${SELECT_CLIENT_COLUMNS} WHERE id = ?`, [42]);
    });

    test('stores null for omitted or empty optional fields', async () => {
      runOk();
      mockDb.get.mockImplementation((q, p, cb) => cb(null, { id: 42 }));

      await request(app).post('/api/clients').send({ name: 'Acme', description: '', department: '', email: '' });
      expect(mockDb.run.mock.calls[0][1]).toEqual(['Acme', null, null, null, USER]);

      await request(app).post('/api/clients').send({ name: 'Acme' });
      expect(mockDb.run.mock.calls[1][1]).toEqual(['Acme', null, null, null, USER]);
    });

    test('logs insert and re-select errors with a descriptive prefix', async () => {
      const insertErr = new Error('insert');
      mockDb.run.mockImplementation((q, p, cb) => cb(insertErr));
      await request(app).post('/api/clients').send({ name: 'Acme' });
      expect(consoleError).toHaveBeenCalledWith('Database error:', insertErr);

      consoleError.mockClear();
      const selectErr = new Error('select');
      runOk();
      mockDb.get.mockImplementation((q, p, cb) => cb(selectErr));
      await request(app).post('/api/clients').send({ name: 'Acme' });
      expect(consoleError).toHaveBeenCalledWith('Database error:', selectErr);
    });
  });

  describe('PUT /api/clients/:id', () => {
    const putAndCapture = async (body) => {
      clientExists();
      runOk();
      mockDb.get.mockImplementationOnce((q, p, cb) => cb(null, { id: 1 }));
      const res = await request(app).put('/api/clients/1').send(body);
      return { res, run: mockDb.run.mock.calls[0] };
    };

    test('checks existence with exact id + user scoped query', async () => {
      await putAndCapture({ name: 'X' });
      expectDbCall(mockDb.get, 0, 'SELECT id FROM clients WHERE id = ? AND user_email = ?', [1, USER]);
    });

    test('builds update for name only', async () => {
      const { run } = await putAndCapture({ name: 'X' });
      expect(run[0]).toBe('UPDATE clients SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_email = ?');
      expect(run[1]).toEqual(['X', 1, USER]);
    });

    test('builds update for description only, mapping empty string to null', async () => {
      const { run } = await putAndCapture({ description: '' });
      expect(run[0]).toBe('UPDATE clients SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_email = ?');
      expect(run[1]).toEqual([null, 1, USER]);
    });

    test('builds update for department only, mapping empty string to null', async () => {
      const { run } = await putAndCapture({ department: '' });
      expect(run[0]).toBe('UPDATE clients SET department = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_email = ?');
      expect(run[1]).toEqual([null, 1, USER]);
    });

    test('builds update for email only, mapping empty string to null', async () => {
      const { run } = await putAndCapture({ email: '' });
      expect(run[0]).toBe('UPDATE clients SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_email = ?');
      expect(run[1]).toEqual([null, 1, USER]);
    });

    test('builds update for all fields in declaration order', async () => {
      const { run } = await putAndCapture({ name: 'N', description: 'D', department: 'Dep', email: 'e@x.com' });
      expect(run[0]).toBe(
        'UPDATE clients SET name = ?, description = ?, department = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_email = ?'
      );
      expect(run[1]).toEqual(['N', 'D', 'Dep', 'e@x.com', 1, USER]);
    });

    test('re-selects updated client by id', async () => {
      await putAndCapture({ name: 'X' });
      expectDbCall(mockDb.get, 1, `${SELECT_CLIENT_COLUMNS} WHERE id = ?`, [1]);
    });

    test('logs existence-check, update and re-select errors with a descriptive prefix', async () => {
      const e1 = new Error('exists');
      mockDb.get.mockImplementationOnce((q, p, cb) => cb(e1));
      await request(app).put('/api/clients/1').send({ name: 'X' });
      expect(consoleError).toHaveBeenCalledWith('Database error:', e1);

      consoleError.mockClear();
      const e2 = new Error('update');
      clientExists();
      mockDb.run.mockImplementation((q, p, cb) => cb(e2));
      await request(app).put('/api/clients/1').send({ name: 'X' });
      expect(consoleError).toHaveBeenCalledWith('Database error:', e2);

      consoleError.mockClear();
      const e3 = new Error('reselect');
      clientExists();
      runOk();
      mockDb.get.mockImplementationOnce((q, p, cb) => cb(e3));
      await request(app).put('/api/clients/1').send({ name: 'X' });
      expect(consoleError).toHaveBeenCalledWith('Database error:', e3);
    });
  });

  describe('DELETE /api/clients (all)', () => {
    test('deletes all clients for the user and reports deletedCount', async () => {
      runOk();
      const res = await request(app).delete('/api/clients');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'All clients deleted successfully', deletedCount: 3 });
      expectDbCall(mockDb.run, 0, 'DELETE FROM clients WHERE user_email = ?', [USER]);
    });

    test('returns 500 and logs on database error', async () => {
      const err = new Error('boom');
      mockDb.run.mockImplementation((q, p, cb) => cb(err));
      const res = await request(app).delete('/api/clients');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to delete clients' });
      expect(consoleError).toHaveBeenCalledWith('Database error:', err);
    });
  });

  describe('DELETE /api/clients/:id', () => {
    test('checks existence then deletes with exact scoped queries', async () => {
      mockDb.get.mockImplementation((q, p, cb) => cb(null, { id: 5 }));
      runOk();
      await request(app).delete('/api/clients/5');
      expectDbCall(mockDb.get, 0, 'SELECT id FROM clients WHERE id = ? AND user_email = ?', [5, USER]);
      expectDbCall(mockDb.run, 0, 'DELETE FROM clients WHERE id = ? AND user_email = ?', [5, USER]);
    });

    test('logs existence-check and delete errors with a descriptive prefix', async () => {
      const e1 = new Error('exists');
      mockDb.get.mockImplementation((q, p, cb) => cb(e1));
      await request(app).delete('/api/clients/5');
      expect(consoleError).toHaveBeenCalledWith('Database error:', e1);

      consoleError.mockClear();
      const e2 = new Error('delete');
      mockDb.get.mockImplementation((q, p, cb) => cb(null, { id: 5 }));
      mockDb.run.mockImplementation((q, p, cb) => cb(e2));
      await request(app).delete('/api/clients/5');
      expect(consoleError).toHaveBeenCalledWith('Database error:', e2);
    });
  });
});
