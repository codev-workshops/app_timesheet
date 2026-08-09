/**
 * Secrets Manager parity suite.
 *
 * The same assertions run with SECRETS_BACKEND=env and SECRETS_BACKEND=aws.
 * The AWS run uses the moto emulator and the real Express app/database.
 */

jest.unmock('sqlite3');

const request = require('supertest');
const app = require('../../app');
const { initializeDatabase } = require('../../database/init');
const {
  getJwtSecret,
  resetJwtSecretCache,
  secretName
} = require('../../config/secrets');

const runE2E = process.env.RUN_E2E === '1';
const describeE2E = runE2E ? describe : describe.skip;
const backend = (process.env.SECRETS_BACKEND || 'env').toLowerCase();
const originalSecret = process.env.JWT_SECRET;

let userSeq = 0;
function newUser() {
  userSeq += 1;
  return `secrets-e2e-${process.pid}-${Date.now()}-${userSeq}@example.com`;
}

describeE2E(`secrets e2e (${backend})`, () => {
  let user;

  beforeAll(async () => {
    process.env.SECRETS_NAME_PREFIX = `e2e-${process.pid}-${Date.now()}-`;
    if (backend === 'aws') {
      const { ensureJwtSecret } = require('../../config/secretsResources');
      await ensureJwtSecret(process.env.JWT_SECRET);
      await ensureJwtSecret(process.env.JWT_SECRET);
    }
    await initializeDatabase();
  }, 60000);

  beforeEach(() => {
    user = newUser();
    process.env.JWT_SECRET = originalSecret;
    resetJwtSecretCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    delete process.env.JWT_SECRET_NAME;
    resetJwtSecretCache();
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    delete process.env.SECRETS_NAME_PREFIX;
    resetJwtSecretCache();
  });

  it('resolves the configured value and caches successful loads', async () => {
    const expected = process.env.JWT_SECRET;
    const first = await getJwtSecret();
    expect(first).toBe(expected);

    if (backend === 'env') {
      process.env.JWT_SECRET = 'changed-after-first-load';
    } else {
      const { client } = require('../../config/secretsClient');
      jest.spyOn(client, 'send').mockRejectedValue(new Error('cache miss'));
    }
    const second = await getJwtSecret();
    expect(second).toBe(expected);
  });

  it('treats missing env and AWS secrets identically', async () => {
    resetJwtSecretCache();
    const savedSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    if (backend === 'env') {
      expect(await getJwtSecret()).toBeUndefined();
    } else {
      process.env.JWT_SECRET = savedSecret;
      process.env.JWT_SECRET_NAME = `missing-${Date.now()}`;
      expect(await getJwtSecret()).toBeUndefined();
      delete process.env.JWT_SECRET_NAME;
    }
    process.env.JWT_SECRET = savedSecret;
  });

  it('keeps startup and existing endpoints working', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('OK');

    const client = await request(app)
      .post('/api/clients')
      .set('x-user-email', user)
      .send({ name: 'Secrets E2E Client' });
    expect(client.status).toBe(201);

    const list = await request(app)
      .get('/api/clients')
      .set('x-user-email', user);
    expect(list.status).toBe(200);
    expect(list.body.clients).toHaveLength(1);
    expect(list.body.clients[0].name).toBe('Secrets E2E Client');

    const deleted = await request(app)
      .delete('/api/clients')
      .set('x-user-email', user);
    expect(deleted.status).toBe(200);
  });

  it('uses the configured unique secret name in AWS mode', () => {
    if (backend === 'aws') {
      expect(secretName()).toMatch(/^e2e-\d+-\d+-timesheet\/jwt-secret$/);
    }
  });
});
