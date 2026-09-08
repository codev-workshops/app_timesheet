const request = require('supertest');
const express = require('express');
const authRoutes = require('../../routes/auth');
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
app.use('/api/auth', authRoutes);
app.use((err, req, res, next) => {
  if (err.isJoi) {
    return res.status(400).json({ error: 'Validation error' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

const USER_QUERY = 'SELECT email, created_at FROM users WHERE email = ?';

describe('Auth Routes - query and parameter contracts', () => {
  let mockDb;
  let consoleError;

  beforeEach(() => {
    mockDb = { get: jest.fn(), run: jest.fn() };
    getDatabase.mockReturnValue(mockDb);
    consoleError = silenceConsoleError();
  });

  afterEach(() => {
    consoleError.mockRestore();
    jest.clearAllMocks();
  });

  describe('POST /api/auth/login', () => {
    test('looks up the user by exact email query', async () => {
      mockDb.get.mockImplementation((q, p, cb) => cb(null, { email: 'a@b.com', created_at: 'x' }));
      await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
      expectDbCall(mockDb.get, 0, USER_QUERY, ['a@b.com']);
    });

    test('logs lookup errors with a descriptive prefix', async () => {
      const err = new Error('lookup');
      mockDb.get.mockImplementation((q, p, cb) => cb(err));
      await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
      expect(consoleError).toHaveBeenCalledWith('Database error:', err);
    });

    test('logs user creation errors with a descriptive prefix', async () => {
      const err = new Error('insert');
      mockDb.get.mockImplementation((q, p, cb) => cb(null, null));
      mockDb.run.mockImplementation((q, p, cb) => cb(err));
      await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
      expect(consoleError).toHaveBeenCalledWith('Error creating user:', err);
    });
  });

  describe('GET /api/auth/me', () => {
    test('looks up the authenticated user by exact email query', async () => {
      mockDb.get.mockImplementation((q, p, cb) => cb(null, { email: 'test@example.com', created_at: 'x' }));
      await request(app).get('/api/auth/me');
      expectDbCall(mockDb.get, 0, USER_QUERY, ['test@example.com']);
    });

    test('logs lookup errors with a descriptive prefix', async () => {
      const err = new Error('lookup');
      mockDb.get.mockImplementation((q, p, cb) => cb(err));
      await request(app).get('/api/auth/me');
      expect(consoleError).toHaveBeenCalledWith('Database error:', err);
    });
  });
});
