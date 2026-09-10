const { authenticateUser, clearKnownUsers } = require('../../middleware/auth');
const { getDatabase } = require('../../database/init');

jest.mock('../../database/init');

describe('Authentication Middleware', () => {
  let req, res, next, mockDb;

  beforeEach(() => {
    req = {
      headers: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
    
    mockDb = {
      get: jest.fn(),
      run: jest.fn((query, params, callback) => callback(null))
    };
    
    getDatabase.mockReturnValue(mockDb);
    clearKnownUsers();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Email Header Validation', () => {
    test('should return 401 if x-user-email header is missing', () => {
      authenticateUser(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'User email required in x-user-email header'
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('should return 400 if email format is invalid', () => {
      req.headers['x-user-email'] = 'invalid-email';

      authenticateUser(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid email format'
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('should accept valid email format', () => {
      req.headers['x-user-email'] = 'test@example.com';

      authenticateUser(req, res, next);

      expect(mockDb.run).toHaveBeenCalled();
    });
  });

  describe('User Upsert', () => {
    test('should upsert user with a single statement and call next()', (done) => {
      req.headers['x-user-email'] = 'newuser@example.com';

      authenticateUser(req, res, next);

      setImmediate(() => {
        expect(mockDb.run).toHaveBeenCalledTimes(1);
        expect(mockDb.run).toHaveBeenCalledWith(
          'INSERT INTO users (email) VALUES (?) ON CONFLICT(email) DO NOTHING',
          ['newuser@example.com'],
          expect.any(Function)
        );
        expect(mockDb.get).not.toHaveBeenCalled();
        expect(req.userEmail).toBe('newuser@example.com');
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        done();
      });
    });

    test('should authenticate existing user (no-op upsert) and call next()', (done) => {
      req.headers['x-user-email'] = 'existing@example.com';

      authenticateUser(req, res, next);

      setImmediate(() => {
        expect(req.userEmail).toBe('existing@example.com');
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        done();
      });
    });

    test('should handle database error during upsert', (done) => {
      req.headers['x-user-email'] = 'test@example.com';

      mockDb.run.mockImplementation((query, params, callback) => {
        callback(new Error('Insert failed'));
      });

      authenticateUser(req, res, next);

      setImmediate(() => {
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Failed to create user'
        });
        expect(next).not.toHaveBeenCalled();
        done();
      });
    });

    test('should not cache a user whose upsert failed', (done) => {
      req.headers['x-user-email'] = 'flaky@example.com';

      mockDb.run.mockImplementationOnce((query, params, callback) => {
        callback(new Error('Insert failed'));
      });

      authenticateUser(req, res, next);

      setImmediate(() => {
        expect(res.status).toHaveBeenCalledWith(500);

        const req2 = { headers: { 'x-user-email': 'flaky@example.com' } };
        const next2 = jest.fn();
        authenticateUser(req2, res, next2);

        setImmediate(() => {
          expect(mockDb.run).toHaveBeenCalledTimes(2);
          expect(next2).toHaveBeenCalled();
          done();
        });
      });
    });
  });

  describe('Known User Cache', () => {
    test('should skip the database for repeat requests from a known user', (done) => {
      req.headers['x-user-email'] = 'cached@example.com';

      authenticateUser(req, res, next);

      setImmediate(() => {
        expect(mockDb.run).toHaveBeenCalledTimes(1);

        const req2 = { headers: { 'x-user-email': 'cached@example.com' } };
        const next2 = jest.fn();
        authenticateUser(req2, res, next2);

        expect(mockDb.run).toHaveBeenCalledTimes(1);
        expect(req2.userEmail).toBe('cached@example.com');
        expect(next2).toHaveBeenCalled();
        done();
      });
    });

    test('should hit the database again after the cache is cleared', (done) => {
      req.headers['x-user-email'] = 'cached@example.com';

      authenticateUser(req, res, next);

      setImmediate(() => {
        clearKnownUsers();
        const req2 = { headers: { 'x-user-email': 'cached@example.com' } };
        authenticateUser(req2, res, jest.fn());

        expect(mockDb.run).toHaveBeenCalledTimes(2);
        done();
      });
    });
  });

  describe('Email Format Edge Cases', () => {
    test('should reject email without @', () => {
      req.headers['x-user-email'] = 'notanemail';
      authenticateUser(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('should reject email without domain', () => {
      req.headers['x-user-email'] = 'test@';
      authenticateUser(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('should reject email without TLD', () => {
      req.headers['x-user-email'] = 'test@domain';
      authenticateUser(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('should accept email with subdomain', () => {
      req.headers['x-user-email'] = 'test@mail.example.com';

      authenticateUser(req, res, next);
      expect(mockDb.run).toHaveBeenCalled();
    });
  });
});
