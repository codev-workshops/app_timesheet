jest.unmock('sqlite3');

const request = require('supertest');
const app = require('../../app');
const { initializeDatabase } = require('../../database/init');
const { initializeExportStorage } = require('../../storage/exportStorage');

const runE2E = process.env.RUN_E2E === '1';
const describeE2E = runE2E ? describe : describe.skip;

let userSeq = 0;
function newUser() {
  userSeq += 1;
  return `export-e2e-${process.pid}-${Date.now()}-${userSeq}@example.com`;
}

async function resolveExport(response) {
  if (process.env.EXPORT_BACKEND === 's3') {
    const object = await fetch(response.body.url);
    return { status: response.status, bytes: Buffer.from(await object.arrayBuffer()) };
  }
  return { status: response.status, bytes: response.body };
}

function exportRequest(path) {
  const req = request(app).get(path);
  if (process.env.EXPORT_BACKEND !== 's3') {
    req.buffer(true).parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  }
  return req;
}

function normalizePdf(bytes) {
  return bytes
    .toString('binary')
    .replace(/Generated: [^\r\n()]*/, 'Generated: masked');
}

describeE2E(`export e2e (${process.env.EXPORT_BACKEND || 'local'})`, () => {
  let user;

  beforeAll(async () => {
    await initializeDatabase();
    await initializeExportStorage();
    await initializeExportStorage();
  }, 60000);

  beforeEach(() => {
    user = newUser();
  });

  afterEach(async () => {
    await request(app).delete('/api/clients').set('x-user-email', user);
  });

  async function createFixture() {
    const clientResponse = await request(app)
      .post('/api/clients')
      .set('x-user-email', user)
      .send({ name: 'Export Parity Co' });
    expect(clientResponse.status).toBe(201);
    const client = clientResponse.body.client;
    const entryResponse = await request(app)
      .post('/api/work-entries')
      .set('x-user-email', user)
      .send({ clientId: client.id, hours: 7.5, description: 'Parity work', date: '2024-01-15' });
    expect(entryResponse.status).toBe(201);
    return client;
  }

  it('returns matching export status codes and content in each backend mode', async () => {
    const client = await createFixture();
    const csv = await resolveExport(await exportRequest(`/api/reports/export/csv/${client.id}`)
      .set('x-user-email', user));
    const pdf = await resolveExport(await exportRequest(`/api/reports/export/pdf/${client.id}`)
      .set('x-user-email', user));
    expect(csv.status).toBe(200);
    expect(csv.bytes.toString()).toContain('Date,Hours,Description,Created At');
    expect(csv.bytes.toString()).toContain('1705276800000,7.5,Parity work');
    expect(pdf.status).toBe(200);
    expect(pdf.bytes.subarray(0, 4).toString()).toBe('%PDF');

    const invalidCsv = await request(app).get('/api/reports/export/csv/not-an-id').set('x-user-email', user);
    const invalidPdf = await request(app).get('/api/reports/export/pdf/not-an-id').set('x-user-email', user);
    expect(invalidCsv.status).toBe(400);
    expect(invalidPdf.status).toBe(400);
    const missingCsv = await request(app).get('/api/reports/export/csv/999999').set('x-user-email', user);
    const missingPdf = await request(app).get('/api/reports/export/pdf/999999').set('x-user-email', user);
    expect(missingCsv.status).toBe(404);
    expect(missingPdf.status).toBe(404);
  });

  (process.env.EXPORT_BACKEND === 's3' ? it : it.skip)(
    'keeps CSV bytes identical and PDF bytes identical apart from generated metadata',
    async () => {
      const client = await createFixture();
      process.env.EXPORT_BACKEND = 'local';
      const localCsv = await resolveExport(await exportRequest(`/api/reports/export/csv/${client.id}`)
        .set('x-user-email', user));
      const localPdf = await resolveExport(await exportRequest(`/api/reports/export/pdf/${client.id}`)
        .set('x-user-email', user));
      process.env.EXPORT_BACKEND = 's3';
      const s3Csv = await resolveExport(await exportRequest(`/api/reports/export/csv/${client.id}`)
        .set('x-user-email', user));
      const s3Pdf = await resolveExport(await exportRequest(`/api/reports/export/pdf/${client.id}`)
        .set('x-user-email', user));
      expect(s3Csv.bytes).toEqual(localCsv.bytes);
      expect(normalizePdf(s3Pdf.bytes)).toBe(normalizePdf(localPdf.bytes));
    }
  );
});
