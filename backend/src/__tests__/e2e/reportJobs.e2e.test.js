jest.unmock('sqlite3');

const request = require('supertest');
const app = require('../../app');
const { initializeDatabase } = require('../../database/init');
const { initializeReportQueue, sendReportJob } = require('../../reports/queue');
const { drainOnce } = require('../../reports/worker');
const { getArtifact } = require('../../reports/artifactStore');
const { generate } = require('../../reports/generator');
const zlib = require('zlib');

const runE2E = process.env.RUN_E2E === '1';
const describeE2E = runE2E ? describe : describe.skip;
const describeSqs = runE2E && process.env.REPORTS_BACKEND === 'sqs' ? describe : describe.skip;
const describeSync = runE2E && (process.env.REPORTS_BACKEND || 'sync') === 'sync'
  ? describe : describe.skip;
let sequence = 0;
const newUser = () => `report-jobs-${process.pid}-${Date.now()}-${++sequence}@example.com`;

function pdfText(bytes) {
  const inflated = bytes.toString('latin1').replace(/stream\r?\n([\s\S]*?)\r?\nendstream/g, (all, body) => {
    try {
      return zlib.inflateSync(Buffer.from(body, 'latin1')).toString('latin1');
    } catch (error) {
      return body;
    }
  });
  const decoded = [...inflated.matchAll(/<([0-9a-f]+)>/gi)]
    .map((match) => Buffer.from(match[1], 'hex').toString('latin1')).join(' ');
  return `${inflated}\n${decoded}`;
}

function normalisePdf(bytes) {
  return bytes.toString('latin1')
    .replace(/\(D:\d+Z\)/g, '(D:NORMALIZED)')
    .replace(/\/ID \[<[^>]+> <[^>]+>\]/g, '/ID [<NORMALIZED> <NORMALIZED>]');
}

describeSqs(`report jobs e2e (${process.env.DB_BACKEND || 'sqlite'})`, () => {
  let user;

  beforeAll(async () => {
    await initializeDatabase();
    if ((process.env.REPORTS_BACKEND || 'sync') === 'sqs') {
      await initializeReportQueue();
      await initializeReportQueue();
    }
  }, 60000);

  beforeEach(() => { user = newUser(); });

  async function createFixture() {
    const clientResponse = await request(app).post('/api/clients').set('x-user-email', user)
      .send({ name: 'Async Reports' });
    const client = clientResponse.body.client;
    await request(app).post('/api/work-entries').set('x-user-email', user)
      .send({ clientId: client.id, hours: 2.5, description: 'Entry one', date: '2024-01-15' });
    await request(app).post('/api/work-entries').set('x-user-email', user)
      .send({ clientId: client.id, hours: 4, description: 'Entry two', date: '2024-01-16' });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const summary = await request(app).get(`/api/reports/client/${client.id}`)
        .set('x-user-email', user);
      if (summary.status === 200 && summary.body.entryCount === 2) return client;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for report entries for client ${client.id}`);
  }

  it('supports CSV enqueue, status, worker completion, and byte parity', async () => {
    const client = await createFixture();
    const sync = await request(app).get(`/api/reports/export/csv/${client.id}`).set('x-user-email', user);
    const queued = await request(app).post('/api/report-jobs').set('x-user-email', user)
      .send({ clientId: client.id, format: 'csv' });
    expect(queued.status).toBe(202);
    expect(queued.body).toEqual({ jobId: expect.any(String), status: 'queued' });
    const jobId = queued.body.jobId;
    expect((await request(app).get(`/api/report-jobs/${jobId}`).set('x-user-email', user)).body).toEqual({
      jobId, status: 'queued', format: 'csv', clientId: client.id
    });
    await drainOnce();
    const done = await request(app).get(`/api/report-jobs/${jobId}`).set('x-user-email', user);
    expect(done.status).toBe(200);
    expect(done.body).toEqual({
      jobId, status: 'done', format: 'csv', clientId: client.id,
      resultLocation: expect.stringMatching(/^file:\/\/.+\/[0-9a-f-]+\.csv$/)
    });
    expect(getArtifact(done.body.resultLocation).toString()).toBe(sync.text);
  });

  it('supports PDF generation and preserves report entry data', async () => {
    const client = await createFixture();
    const sync = await request(app).get(`/api/reports/export/pdf/${client.id}`).set('x-user-email', user);
    const queued = await request(app).post('/api/report-jobs').set('x-user-email', user)
      .send({ clientId: client.id, format: 'pdf' });
    expect(queued.body).toEqual({ jobId: expect.any(String), status: 'queued' });
    expect((await request(app).get(`/api/report-jobs/${queued.body.jobId}`).set('x-user-email', user)).body)
      .toEqual({ jobId: queued.body.jobId, status: 'queued', format: 'pdf', clientId: client.id });
    await drainOnce();
    const done = await request(app).get(`/api/report-jobs/${queued.body.jobId}`).set('x-user-email', user);
    expect(done.body).toEqual({
      jobId: queued.body.jobId, status: 'done', format: 'pdf', clientId: client.id,
      resultLocation: expect.stringMatching(/^file:\/\/.+\/[0-9a-f-]+\.pdf$/)
    });
    const asyncPdf = getArtifact(done.body.resultLocation);
    expect(asyncPdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sync.body.subarray(0, 5).toString()).toBe('%PDF-');
    const asyncText = pdfText(asyncPdf).replace(/Generated: [^\r\n]+/g, 'Generated: NORMALIZED');
    const syncText = pdfText(sync.body).replace(/Generated: [^\r\n]+/g, 'Generated: NORMALIZED');
    expect(asyncText).toMatch(/Async Repor\s*ts/);
    expect(asyncText).toMatch(/Entr\s*y one/);
    expect(asyncText).toMatch(/Entr\s*y tw\s*o/);
    expect(syncText).toMatch(/Async Repor\s*ts/);
    expect(syncText).toMatch(/Entr\s*y one/);
    expect(syncText).toMatch(/Entr\s*y tw\s*o/);
    const fixedData = { client: { name: 'Fixed' }, workEntries: [] };
    const fixedTime = new Date('2020-01-01T00:00:00Z');
    expect(normalisePdf(await generate('pdf', fixedData, fixedTime)))
      .toBe(normalisePdf(await generate('pdf', fixedData, fixedTime)));
  });

  it('handles failed jobs and consumes the failed message', async () => {
    const client = await createFixture();
    const queued = await request(app).post('/api/report-jobs').set('x-user-email', user)
      .send({ clientId: client.id, format: 'csv' });
    expect(queued.body).toEqual({ jobId: expect.any(String), status: 'queued' });
    await request(app).delete(`/api/clients/${client.id}`).set('x-user-email', user);
    expect(await drainOnce()).toHaveLength(1);
    const failed = await request(app).get(`/api/report-jobs/${queued.body.jobId}`).set('x-user-email', user);
    expect(failed.body).toEqual({
      jobId: queued.body.jobId, status: 'failed', format: 'csv', clientId: client.id,
      error: 'Client not found'
    });
    expect(await drainOnce()).toEqual([]);
  });

  it('is idempotent when a done job is genuinely redelivered', async () => {
    const client = await createFixture();
    const queued = await request(app).post('/api/report-jobs').set('x-user-email', user)
      .send({ clientId: client.id, format: 'csv' });
    await drainOnce();
    const before = await request(app).get(`/api/report-jobs/${queued.body.jobId}`).set('x-user-email', user);
    await sendReportJob({ jobId: queued.body.jobId });
    expect(await drainOnce()).toHaveLength(1);
    const after = await request(app).get(`/api/report-jobs/${queued.body.jobId}`).set('x-user-email', user);
    expect(after.body).toEqual(before.body);
    expect(await drainOnce()).toEqual([]);
  });

  it('returns exact validation, ownership, and authentication errors', async () => {
    const badId = await request(app).post('/api/report-jobs').set('x-user-email', user)
      .send({ clientId: 'abc', format: 'csv' });
    expect(badId.status).toBe(400);
    expect(badId.body).toEqual({ error: 'Invalid client ID' });
    const parsedId = await request(app).post('/api/report-jobs').set('x-user-email', user)
      .send({ clientId: '12abc', format: 'csv' });
    expect(parsedId.status).toBe(404);
    expect(parsedId.body).toEqual({ error: 'Client not found' });
    const badFormat = await request(app).post('/api/report-jobs').set('x-user-email', user)
      .send({ clientId: 1, format: 'txt' });
    expect(badFormat.status).toBe(400);
    expect(badFormat.body.error).toBe('Validation error');
    const missing = await request(app).post('/api/report-jobs').set('x-user-email', user)
      .send({ clientId: 1 });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('Validation error');
    const unknownClient = await request(app).post('/api/report-jobs').set('x-user-email', user)
      .send({ clientId: 999999, format: 'csv' });
    expect(unknownClient.status).toBe(404);
    expect(unknownClient.body).toEqual({ error: 'Client not found' });
    const traversal = await request(app)
      .get('/api/report-jobs/..%2F..%2F..%2Fetc%2Fpasswd').set('x-user-email', user);
    expect(traversal.status).toBe(404);
    expect(traversal.body).toEqual({ error: 'Job not found' });
    const client = await createFixture();
    const owned = await request(app).post('/api/report-jobs').set('x-user-email', user)
      .send({ clientId: client.id, format: 'csv' });
    const otherUser = newUser();
    const foreign = await request(app).get(`/api/report-jobs/${owned.body.jobId}`)
      .set('x-user-email', otherUser);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: 'Job not found' });
    expect((await request(app).get('/api/report-jobs/unknown').set('x-user-email', user)).body)
      .toEqual({ error: 'Job not found' });
    expect((await request(app).get('/api/report-jobs/unknown')).status).toBe(401);
    expect((await request(app).get('/api/report-jobs/unknown').set('x-user-email', 'bad')).body)
      .toEqual({ error: 'Invalid email format' });
  });
});

describeSync('report jobs sync absence', () => {
  it('does not mount job routes in sync mode', async () => {
    const response = await request(app).post('/api/report-jobs').send({});
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Route not found' });
  });
});
