const request = require('supertest');
const express = require('express');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { createObjectCsvWriter } = require('csv-writer');
const { initializeDatabase, getDatabase, closeDatabase } = require('../../database/init');
const { errorHandler } = require('../../middleware/errorHandler');

jest.unmock('sqlite3');
jest.mock('csv-writer', () => ({
  createObjectCsvWriter: jest.fn(() => ({
    writeRecords: jest.fn().mockResolvedValue(undefined)
  }))
}));

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.download = (filePath, filename, callback) => {
    const writer = createObjectCsvWriter.mock.results.at(-1).value;
    res.json({ records: writer.writeRecords.mock.calls[0][0] });
    callback(null);
  };
  next();
});
app.use('/api/auth', require('../../routes/auth'));
app.use('/api/clients', require('../../routes/clients'));
app.use('/api/work-entries', require('../../routes/workEntries'));
app.use('/api/reports', require('../../routes/reports'));
app.use(errorHandler);

const alice = 'alice@example.com';
const bob = 'bob@example.com';
const query = (sql, params = []) => new Promise((resolve, reject) => {
  getDatabase().all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});
const run = (sql, params = []) => new Promise((resolve, reject) => {
  getDatabase().run(sql, params, (err) => err ? reject(err) : resolve());
});
const createClient = async (user, name = 'Shared Client') => {
  const response = await request(app).post('/api/clients')
    .set('x-user-email', user)
    .send({ name, description: 'Shared description', department: 'Engineering', email: 'contact@example.com' })
    .expect(201);
  return response.body.client;
};
const createEntry = async (user, clientId, hours, description) => {
  const response = await request(app).post('/api/work-entries')
    .set('x-user-email', user)
    .send({ clientId, hours, description, date: '2026-09-10' })
    .expect(201);
  return response.body.workEntry;
};

describe('Shared clients with real SQLite and user-scoped time tracking', () => {
  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    await initializeDatabase();
    await query('SELECT name FROM sqlite_master WHERE type = ?', ['table']);
  });

  afterEach(async () => {
    await closeDatabase();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test('a second login can list and retrieve the first user\'s client with all contact fields', async () => {
    await request(app).post('/api/auth/login').send({ email: alice }).expect(201);
    const client = await createClient(alice);
    await request(app).post('/api/auth/login').send({ email: bob }).expect(201);

    const list = await request(app).get('/api/clients').set('x-user-email', bob).expect(200);
    expect(list.body.clients).toEqual([client]);
    const detail = await request(app).get(`/api/clients/${client.id}`).set('x-user-email', bob).expect(200);
    expect(detail.body.client).toEqual(client);
    expect(client).toMatchObject({ department: 'Engineering', email: 'contact@example.com' });
  });

  test('another user can edit and delete an unused shared client', async () => {
    const client = await createClient(alice);
    await request(app).put(`/api/clients/${client.id}`).set('x-user-email', bob)
      .send({ name: 'Updated by Bob', department: 'Finance', email: 'updated@example.com' }).expect(200);
    const updated = await request(app).get(`/api/clients/${client.id}`).set('x-user-email', alice).expect(200);
    expect(updated.body.client).toMatchObject({ name: 'Updated by Bob', department: 'Finance', email: 'updated@example.com' });
    await request(app).delete(`/api/clients/${client.id}`).set('x-user-email', bob).expect(200);
    const list = await request(app).get('/api/clients').set('x-user-email', alice).expect(200);
    expect(list.body.clients).toEqual([]);
  });

  test('both users log time to the same client but lists and reports contain only their own entries', async () => {
    const client = await createClient(alice);
    const aliceEntry = await createEntry(alice, client.id, 2, 'Private Alice work');
    const bobEntry = await createEntry(bob, client.id, 3.5, 'Private Bob work');

    for (const [user, entry, hours] of [[alice, aliceEntry, 2], [bob, bobEntry, 3.5]]) {
      for (const path of ['/api/work-entries', `/api/work-entries?clientId=${client.id}`]) {
        const list = await request(app).get(path).set('x-user-email', user).expect(200);
        expect(list.body.workEntries.map(row => row.id)).toEqual([entry.id]);
      }
      const report = await request(app).get(`/api/reports/client/${client.id}`).set('x-user-email', user).expect(200);
      expect(report.body).toMatchObject({ totalHours: hours, entryCount: 1 });
      expect(report.body.workEntries.map(row => row.id)).toEqual([entry.id]);
      expect(await query('SELECT user_email FROM work_entries WHERE id = ? AND user_email = ?', [entry.id, user]))
        .toEqual([{ user_email: user }]);
    }

    const empty = await request(app).get(`/api/reports/client/${client.id}`)
      .set('x-user-email', 'charlie@example.com').expect(200);
    expect(empty.body).toMatchObject({ workEntries: [], totalHours: 0, entryCount: 0 });
  });

  test('users cannot retrieve, change, or delete another user\'s work entries', async () => {
    const client = await createClient(alice);
    const entry = await createEntry(alice, client.id, 2, 'Private Alice work');
    await request(app).get(`/api/work-entries/${entry.id}`).set('x-user-email', bob).expect(404);
    await request(app).put(`/api/work-entries/${entry.id}`).set('x-user-email', bob)
      .send({ hours: 8 }).expect(404);
    await request(app).delete(`/api/work-entries/${entry.id}`).set('x-user-email', bob).expect(404);
    const own = await request(app).get(`/api/work-entries/${entry.id}`).set('x-user-email', alice).expect(200);
    expect(own.body.workEntry).toMatchObject({ hours: 2, description: 'Private Alice work' });
  });

  test('a user can reassign their own time entry to any existing shared client', async () => {
    const first = await createClient(bob, 'First Client');
    const second = await createClient(alice, 'Second Client');
    const entry = await createEntry(bob, first.id, 1, 'Bob work');
    const updated = await request(app).put(`/api/work-entries/${entry.id}`).set('x-user-email', bob)
      .send({ clientId: second.id, hours: 4 }).expect(200);
    expect(updated.body.workEntry).toMatchObject({ client_id: second.id, hours: 4 });
    await request(app).put(`/api/work-entries/${entry.id}`).set('x-user-email', bob)
      .send({ clientId: 99999 }).expect(400);
    await request(app).post('/api/work-entries').set('x-user-email', bob)
      .send({ clientId: 99999, hours: 1, date: '2026-09-10' }).expect(400);
  });

  test('single and bulk client deletion cannot erase any user\'s time or partially delete clients', async () => {
    const unused = await createClient(bob, 'Unused Client');
    const client = await createClient(alice);
    const entry = await createEntry(alice, client.id, 2, 'Preserved Alice work');
    await request(app).delete(`/api/clients/${client.id}`).set('x-user-email', bob).expect(409);
    await request(app).delete('/api/clients').set('x-user-email', bob).expect(409);
    const list = await request(app).get('/api/clients').set('x-user-email', bob).expect(200);
    expect(list.body.clients.map(row => row.id).sort()).toEqual([client.id, unused.id].sort());
    await request(app).get(`/api/work-entries/${entry.id}`).set('x-user-email', alice).expect(200);
    await expect(run('DELETE FROM clients WHERE id = ?', [client.id])).rejects.toThrow(/FOREIGN KEY/);
  });

  test('bulk deletion removes unused clients created by different users', async () => {
    await createClient(alice, 'Alice Client');
    await createClient(bob, 'Bob Client');
    const deleted = await request(app).delete('/api/clients').set('x-user-email', bob).expect(200);
    expect(deleted.body.deletedCount).toBe(2);
    const list = await request(app).get('/api/clients').set('x-user-email', alice).expect(200);
    expect(list.body.clients).toEqual([]);
  });

  test('CSV and PDF exports for a shared client exclude other users\' work', async () => {
    const client = await createClient(alice);
    await createEntry(alice, client.id, 2, 'Private Alice work');
    await createEntry(bob, client.id, 3.5, 'Private Bob work');
    const text = jest.spyOn(PDFDocument.prototype, 'text');
    const pdf = await request(app).get(`/api/reports/export/pdf/${client.id}`).set('x-user-email', bob).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const content = text.mock.calls.map(([value]) => String(value));
    expect(content).toContain('Private Bob work');
    expect(content).toContain('Total Hours: 3.50');
    expect(content).not.toContain('Private Alice work');

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'unlink').mockImplementation((path, callback) => callback(null));
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-09-10T12:00:00.000Z');
    const csv = await request(app).get(`/api/reports/export/csv/${client.id}`).set('x-user-email', bob).expect(200);
    expect(csv.body.records).toHaveLength(1);
    expect(csv.body.records[0]).toMatchObject({ hours: 3.5, description: 'Private Bob work' });
    const aliceCsv = await request(app).get(`/api/reports/export/csv/${client.id}`).set('x-user-email', alice).expect(200);
    expect(aliceCsv.body.records).toHaveLength(1);
    expect(aliceCsv.body.records[0]).toMatchObject({ hours: 2, description: 'Private Alice work' });
    const paths = createObjectCsvWriter.mock.calls.map(([options]) => options.path);
    expect(new Set(paths).size).toBe(2);
  });

  test('client schema has no user ownership and deleting a user preserves shared clients and others\' time', async () => {
    const client = await createClient(alice);
    await createEntry(alice, client.id, 2, 'Alice work');
    const bobEntry = await createEntry(bob, client.id, 3, 'Bob work');
    expect((await query('PRAGMA table_info(clients)')).map(column => column.name)).not.toContain('user_email');
    expect(await query('PRAGMA foreign_key_list(clients)')).toEqual([]);
    expect(await query('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    await run('DELETE FROM users WHERE email = ?', [alice]);
    const list = await request(app).get('/api/clients').set('x-user-email', bob).expect(200);
    expect(list.body.clients).toEqual([client]);
    const report = await request(app).get(`/api/reports/client/${client.id}`).set('x-user-email', bob).expect(200);
    expect(report.body.workEntries.map(row => row.id)).toEqual([bobEntry.id]);
  });

  test('shared clients still require login and entry ownership cannot be supplied in the body', async () => {
    await request(app).get('/api/clients').expect(401);
    await request(app).post('/api/clients').send({ name: 'No login' }).expect(401);
    const client = await createClient(alice);
    await request(app).post('/api/work-entries').set('x-user-email', bob)
      .send({ clientId: client.id, hours: 1, date: '2026-09-10', user_email: alice }).expect(400);
    expect(await query('SELECT id FROM work_entries WHERE user_email = ?', [alice])).toEqual([]);
    expect(await query('SELECT id FROM work_entries WHERE user_email = ?', [bob])).toEqual([]);
  });
});
