/**
 * End-to-end parity suite.
 *
 * This suite talks to the real Express app over HTTP with supertest and uses
 * the REAL database layer (no `database/init` mock, no sqlite3 mock). The same
 * assertions run against both backends:
 *
 *   DB_BACKEND=sqlite   RUN_E2E=1 npm run test:e2e:sqlite
 *   DB_BACKEND=dynamodb RUN_E2E=1 npm run test:e2e:dynamo   (emulator required)
 *
 * Any behavioural difference between the two backends makes one of the two
 * runs fail, which fails `npm run test:parity`.
 */

jest.unmock('sqlite3');

const request = require('supertest');
const app = require('../../app');
const { initializeDatabase } = require('../../database/init');

const runE2E = process.env.RUN_E2E === '1';
const describeE2E = runE2E ? describe : describe.skip;

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

let userSeq = 0;
function newUser() {
  userSeq += 1;
  return `e2e-${process.pid}-${Date.now()}-${userSeq}@example.com`;
}

describeE2E(`routes e2e (${process.env.DB_BACKEND || 'sqlite'})`, () => {
  let user;

  beforeAll(async () => {
    await initializeDatabase();
  }, 60000);

  beforeEach(() => {
    user = newUser();
  });

  afterEach(async () => {
    // Cascade-deletes the user's work entries too.
    await request(app).delete('/api/clients').set('x-user-email', user);
  });

  const createClient = async (overrides = {}) => {
    const response = await request(app)
      .post('/api/clients')
      .set('x-user-email', user)
      .send({ name: 'Acme Corp', description: 'A client', department: 'Eng', ...overrides });
    expect(response.status).toBe(201);
    return response.body.client;
  };

  const createEntry = async (clientId, overrides = {}) => {
    const response = await request(app)
      .post('/api/work-entries')
      .set('x-user-email', user)
      .send({ clientId, hours: 7.5, description: 'Worked', date: '2024-01-15', ...overrides });
    expect(response.status).toBe(201);
    return response.body.workEntry;
  };

  describe('authentication', () => {
    it('rejects a missing user header', async () => {
      const response = await request(app).get('/api/clients');
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'User email required in x-user-email header' });
    });

    it('rejects a malformed user header', async () => {
      const response = await request(app).get('/api/clients').set('x-user-email', 'not-an-email');
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid email format' });
    });

    it('creates the user on first login and reuses it afterwards', async () => {
      const first = await request(app).post('/api/auth/login').send({ email: user });
      expect(first.status).toBe(201);
      expect(first.body.message).toBe('User created and logged in successfully');
      expect(first.body.user.email).toBe(user);

      const second = await request(app).post('/api/auth/login').send({ email: user });
      expect(second.status).toBe(200);
      expect(second.body.message).toBe('Login successful');
      expect(second.body.user.email).toBe(user);
      expect(second.body.user.createdAt).toMatch(TIMESTAMP_PATTERN);

      const me = await request(app).get('/api/auth/me').set('x-user-email', user);
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe(user);
      expect(me.body.user.createdAt).toMatch(TIMESTAMP_PATTERN);
    });

    it('rejects an invalid login payload', async () => {
      const response = await request(app).post('/api/auth/login').send({ email: 'nope' });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation error');
    });
  });

  describe('clients', () => {
    it('starts with an empty list', async () => {
      const response = await request(app).get('/api/clients').set('x-user-email', user);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ clients: [] });
    });

    it('creates, reads, updates and deletes a client', async () => {
      const created = await createClient({ email: 'contact@acme.com' });
      expect(typeof created.id).toBe('number');
      expect(created.name).toBe('Acme Corp');
      expect(created.description).toBe('A client');
      expect(created.department).toBe('Eng');
      expect(created.email).toBe('contact@acme.com');
      expect(created.created_at).toMatch(TIMESTAMP_PATTERN);
      expect(created.updated_at).toMatch(TIMESTAMP_PATTERN);
      expect(Object.keys(created).sort()).toEqual([
        'created_at', 'department', 'description', 'email', 'id', 'name', 'updated_at'
      ]);

      const fetched = await request(app).get(`/api/clients/${created.id}`).set('x-user-email', user);
      expect(fetched.status).toBe(200);
      expect(fetched.body).toEqual({ client: created });

      const list = await request(app).get('/api/clients').set('x-user-email', user);
      expect(list.status).toBe(200);
      expect(list.body).toEqual({ clients: [created] });

      const updated = await request(app)
        .put(`/api/clients/${created.id}`)
        .set('x-user-email', user)
        .send({ name: 'Acme Renamed', description: '' });
      expect(updated.status).toBe(200);
      expect(updated.body.message).toBe('Client updated successfully');
      expect(updated.body.client.id).toBe(created.id);
      expect(updated.body.client.name).toBe('Acme Renamed');
      expect(updated.body.client.description).toBeNull();
      expect(updated.body.client.created_at).toBe(created.created_at);

      const deleted = await request(app)
        .delete(`/api/clients/${created.id}`)
        .set('x-user-email', user);
      expect(deleted.status).toBe(200);
      expect(deleted.body).toEqual({ message: 'Client deleted successfully' });

      const gone = await request(app).get(`/api/clients/${created.id}`).set('x-user-email', user);
      expect(gone.status).toBe(404);
      expect(gone.body).toEqual({ error: 'Client not found' });
    });

    it('stores optional fields as null when omitted', async () => {
      const created = await request(app)
        .post('/api/clients')
        .set('x-user-email', user)
        .send({ name: 'Minimal' });
      expect(created.status).toBe(201);
      expect(created.body.client.description).toBeNull();
      expect(created.body.client.department).toBeNull();
      expect(created.body.client.email).toBeNull();
    });

    it('orders the list by name', async () => {
      await createClient({ name: 'Charlie' });
      await createClient({ name: 'Alpha' });
      await createClient({ name: 'Bravo' });

      const list = await request(app).get('/api/clients').set('x-user-email', user);
      expect(list.status).toBe(200);
      expect(list.body.clients.map((client) => client.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('isolates clients per user', async () => {
      const created = await createClient({ name: 'Private' });
      const otherUser = newUser();

      const list = await request(app).get('/api/clients').set('x-user-email', otherUser);
      expect(list.status).toBe(200);
      expect(list.body).toEqual({ clients: [] });

      const fetched = await request(app)
        .get(`/api/clients/${created.id}`)
        .set('x-user-email', otherUser);
      expect(fetched.status).toBe(404);
    });

    it('validates ids and payloads', async () => {
      const badId = await request(app).get('/api/clients/abc').set('x-user-email', user);
      expect(badId.status).toBe(400);
      expect(badId.body).toEqual({ error: 'Invalid client ID' });

      const badBody = await request(app).post('/api/clients').set('x-user-email', user).send({});
      expect(badBody.status).toBe(400);
      expect(badBody.body.error).toBe('Validation error');

      const missingUpdate = await request(app)
        .put('/api/clients/999999')
        .set('x-user-email', user)
        .send({ name: 'Nope' });
      expect(missingUpdate.status).toBe(404);
      expect(missingUpdate.body).toEqual({ error: 'Client not found' });

      const missingDelete = await request(app)
        .delete('/api/clients/999999')
        .set('x-user-email', user);
      expect(missingDelete.status).toBe(404);
      expect(missingDelete.body).toEqual({ error: 'Client not found' });
    });

    it('reports the number of deleted clients', async () => {
      await createClient({ name: 'One' });
      await createClient({ name: 'Two' });

      const response = await request(app).delete('/api/clients').set('x-user-email', user);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'All clients deleted successfully',
        deletedCount: 2
      });

      const empty = await request(app).delete('/api/clients').set('x-user-email', user);
      expect(empty.body.deletedCount).toBe(0);
    });
  });

  describe('work entries', () => {
    it('creates, reads, updates and deletes a work entry', async () => {
      const client = await createClient({ name: 'Entries Co' });
      const entry = await createEntry(client.id);

      expect(typeof entry.id).toBe('number');
      expect(entry.client_id).toBe(client.id);
      expect(entry.client_name).toBe('Entries Co');
      expect(entry.hours).toBe(7.5);
      expect(entry.description).toBe('Worked');
      expect(entry.date).toBe(Date.parse('2024-01-15'));
      expect(entry.created_at).toMatch(TIMESTAMP_PATTERN);
      expect(Object.keys(entry).sort()).toEqual([
        'client_id', 'client_name', 'created_at', 'date', 'description',
        'hours', 'id', 'updated_at'
      ]);

      const fetched = await request(app)
        .get(`/api/work-entries/${entry.id}`)
        .set('x-user-email', user);
      expect(fetched.status).toBe(200);
      expect(fetched.body).toEqual({ workEntry: entry });

      const list = await request(app).get('/api/work-entries').set('x-user-email', user);
      expect(list.status).toBe(200);
      expect(list.body).toEqual({ workEntries: [entry] });

      const updated = await request(app)
        .put(`/api/work-entries/${entry.id}`)
        .set('x-user-email', user)
        .send({ hours: 3.25, description: '' });
      expect(updated.status).toBe(200);
      expect(updated.body.message).toBe('Work entry updated successfully');
      expect(updated.body.workEntry.hours).toBe(3.25);
      expect(updated.body.workEntry.description).toBeNull();
      expect(updated.body.workEntry.client_name).toBe('Entries Co');
      expect(updated.body.workEntry.date).toBe(entry.date);

      const deleted = await request(app)
        .delete(`/api/work-entries/${entry.id}`)
        .set('x-user-email', user);
      expect(deleted.status).toBe(200);
      expect(deleted.body).toEqual({ message: 'Work entry deleted successfully' });

      const gone = await request(app)
        .get(`/api/work-entries/${entry.id}`)
        .set('x-user-email', user);
      expect(gone.status).toBe(404);
      expect(gone.body).toEqual({ error: 'Work entry not found' });
    });

    it('filters and orders entries', async () => {
      const clientA = await createClient({ name: 'Client A' });
      const clientB = await createClient({ name: 'Client B' });

      const oldest = await createEntry(clientA.id, { date: '2024-01-01', hours: 1 });
      const newest = await createEntry(clientA.id, { date: '2024-03-01', hours: 2 });
      const middle = await createEntry(clientB.id, { date: '2024-02-01', hours: 3 });

      const all = await request(app).get('/api/work-entries').set('x-user-email', user);
      expect(all.status).toBe(200);
      expect(all.body.workEntries.map((e) => e.id)).toEqual([newest.id, middle.id, oldest.id]);
      expect(all.body.workEntries.map((e) => e.client_name)).toEqual([
        'Client A', 'Client B', 'Client A'
      ]);

      const filtered = await request(app)
        .get(`/api/work-entries?clientId=${clientA.id}`)
        .set('x-user-email', user);
      expect(filtered.status).toBe(200);
      expect(filtered.body.workEntries.map((e) => e.id)).toEqual([newest.id, oldest.id]);

      const badFilter = await request(app)
        .get('/api/work-entries?clientId=abc')
        .set('x-user-email', user);
      expect(badFilter.status).toBe(400);
      expect(badFilter.body).toEqual({ error: 'Invalid client ID' });
    });

    it('validates ids, payloads and client ownership', async () => {
      const badId = await request(app).get('/api/work-entries/abc').set('x-user-email', user);
      expect(badId.status).toBe(400);
      expect(badId.body).toEqual({ error: 'Invalid work entry ID' });

      const missing = await request(app).get('/api/work-entries/999999').set('x-user-email', user);
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ error: 'Work entry not found' });

      const unknownClient = await request(app)
        .post('/api/work-entries')
        .set('x-user-email', user)
        .send({ clientId: 999999, hours: 1, date: '2024-01-15' });
      expect(unknownClient.status).toBe(400);
      expect(unknownClient.body).toEqual({ error: 'Client not found or does not belong to user' });

      const badBody = await request(app)
        .post('/api/work-entries')
        .set('x-user-email', user)
        .send({ clientId: 1 });
      expect(badBody.status).toBe(400);
      expect(badBody.body.error).toBe('Validation error');

      const missingUpdate = await request(app)
        .put('/api/work-entries/999999')
        .set('x-user-email', user)
        .send({ hours: 2 });
      expect(missingUpdate.status).toBe(404);

      const missingDelete = await request(app)
        .delete('/api/work-entries/999999')
        .set('x-user-email', user);
      expect(missingDelete.status).toBe(404);
    });

    it('rejects moving an entry to a client owned by someone else', async () => {
      const client = await createClient({ name: 'Owned' });
      const entry = await createEntry(client.id);

      const response = await request(app)
        .put(`/api/work-entries/${entry.id}`)
        .set('x-user-email', user)
        .send({ clientId: 999999 });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Client not found or does not belong to user' });
    });

    it('hides entries whose client was deleted', async () => {
      const client = await createClient({ name: 'Doomed' });
      const entry = await createEntry(client.id);

      const deleted = await request(app)
        .delete(`/api/clients/${client.id}`)
        .set('x-user-email', user);
      expect(deleted.status).toBe(200);

      const list = await request(app).get('/api/work-entries').set('x-user-email', user);
      expect(list.status).toBe(200);
      expect(list.body).toEqual({ workEntries: [] });

      const fetched = await request(app)
        .get(`/api/work-entries/${entry.id}`)
        .set('x-user-email', user);
      expect(fetched.status).toBe(404);
      expect(fetched.body).toEqual({ error: 'Work entry not found' });
    });
  });

  describe('reports', () => {
    it('summarises hours for a client', async () => {
      const client = await createClient({ name: 'Report Co' });
      await createEntry(client.id, { date: '2024-01-01', hours: 2.5, description: 'First' });
      await createEntry(client.id, { date: '2024-02-01', hours: 4, description: 'Second' });

      const response = await request(app)
        .get(`/api/reports/client/${client.id}`)
        .set('x-user-email', user);
      expect(response.status).toBe(200);
      expect(response.body.client).toEqual({ id: client.id, name: 'Report Co' });
      expect(response.body.totalHours).toBe(6.5);
      expect(response.body.entryCount).toBe(2);
      expect(response.body.workEntries.map((e) => e.description)).toEqual(['Second', 'First']);
      expect(Object.keys(response.body.workEntries[0]).sort()).toEqual([
        'created_at', 'date', 'description', 'hours', 'id', 'updated_at'
      ]);
    });

    it('returns an empty summary for a client with no entries', async () => {
      const client = await createClient({ name: 'Quiet Co' });

      const response = await request(app)
        .get(`/api/reports/client/${client.id}`)
        .set('x-user-email', user);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        client: { id: client.id, name: 'Quiet Co' },
        workEntries: [],
        totalHours: 0,
        entryCount: 0
      });
    });

    it('validates the client id', async () => {
      const badId = await request(app).get('/api/reports/client/abc').set('x-user-email', user);
      expect(badId.status).toBe(400);
      expect(badId.body).toEqual({ error: 'Invalid client ID' });

      const missing = await request(app)
        .get('/api/reports/client/999999')
        .set('x-user-email', user);
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ error: 'Client not found' });
    });

    it('exports CSV and PDF', async () => {
      const client = await createClient({ name: 'Export Co' });
      await createEntry(client.id, { date: '2024-01-01', hours: 2 });

      const csv = await request(app)
        .get(`/api/reports/export/csv/${client.id}`)
        .set('x-user-email', user);
      expect(csv.status).toBe(200);
      expect(csv.text).toContain('Hours');

      const pdf = await request(app)
        .get(`/api/reports/export/pdf/${client.id}`)
        .set('x-user-email', user);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');

      const missingCsv = await request(app)
        .get('/api/reports/export/csv/999999')
        .set('x-user-email', user);
      expect(missingCsv.status).toBe(404);

      const missingPdf = await request(app)
        .get('/api/reports/export/pdf/999999')
        .set('x-user-email', user);
      expect(missingPdf.status).toBe(404);
    });
  });
});
