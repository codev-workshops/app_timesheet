/*
 * DynamoDB adapter that emulates the subset of the node-sqlite3 `Database`
 * surface used by this application (`get`, `all`, `run`, `serialize`).
 *
 * The routes and middleware issue a small, finite set of SQL statements. This
 * adapter matches each statement on a stable substring and translates it into
 * DynamoDB API calls, so `routes/*.js` (and their existing mocked unit tests)
 * do not have to change.
 *
 * EMULATED vs NATIVE — where DynamoDB cannot do what SQLite does:
 *
 * 1. JOINs. SQLite runs `work_entries we JOIN clients c ON we.client_id = c.id`
 *    in the engine. DynamoDB has no joins, so `client_name` is resolved with an
 *    extra GetItem per distinct client. INNER JOIN semantics are preserved:
 *    a row whose client no longer exists is DROPPED from the result, which is
 *    exactly what SQLite does (note: SQLite foreign keys are OFF by default in
 *    this app, so orphan work entries survive a client delete there too and are
 *    only hidden by the inner join).
 *
 * 2. ON DELETE CASCADE. Not available. Deleting a client explicitly queries and
 *    deletes that client's work entries. Observable behaviour matches SQLite
 *    (where the orphans are invisible through the inner join anyway).
 *
 * 3. AUTOINCREMENT. There is no server-side sequence. An atomic counter item is
 *    kept per table (partition key `__counter__`) and bumped with an
 *    UpdateItem `ADD` expression; the resulting integer is surfaced as
 *    `this.lastID` from `run`, mirroring sqlite3.
 *
 * 4. CURRENT_TIMESTAMP / DEFAULT CURRENT_TIMESTAMP. Generated in the adapter
 *    using SQLite's `YYYY-MM-DD HH:MM:SS` UTC format so response bodies have
 *    the same shape as the SQLite backend.
 *
 * 5. Parameter binding. node-sqlite3 stores a bound JS `Date` as epoch
 *    milliseconds; the adapter does the same conversion so `date` values come
 *    back byte-identical on both backends. (This is also why the
 *    `client-index` sort key is typed `N`, not `S`.)
 *
 * 6. ORDER BY. Sorting (`ORDER BY name`, `ORDER BY date DESC, created_at DESC`)
 *    happens in JS after the Query, with a deterministic `id` tie-break.
 *
 * 7. Transactions / consistency. SQLite statements are serialized and
 *    immediately consistent. DynamoDB writes here are individual, non
 *    transactional requests, and Global Secondary Indexes are only eventually
 *    consistent — the post-insert `WHERE id = ?` lookup therefore prefers a
 *    strongly-consistent GetItem on the base table (the owning `user_email` is
 *    remembered in-process at write time) and only falls back to a retried
 *    `id-index` Query.
 *
 * 8. `changes`. DynamoDB does not report affected-row counts, so deletes and
 *    updates use `ReturnValues: 'ALL_OLD'` / conditional writes to derive
 *    `this.changes`, keeping `deletedCount` correct.
 */

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand
} = require('@aws-sdk/lib-dynamodb');

const { tableNames } = require('./dynamoTables');
const { client } = require('./dynamoClient');

const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true }
});

const COUNTER_KEY = '__counter__';

// Remembers the partition key of every row we wrote, so a `WHERE id = ?`
// lookup can use a strongly-consistent base-table read instead of racing the
// eventually-consistent `id-index` GSI.
const ownerCache = { clients: new Map(), work_entries: new Map() };

function currentTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// node-sqlite3 binds a Date as epoch milliseconds; match that exactly.
function bindValue(value) {
  if (value instanceof Date) return value.getTime();
  return value === undefined ? null : value;
}

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return a < b ? -1 : 1;
}

function pick(item, columns) {
  const out = {};
  for (const column of columns) {
    out[column] = item[column] === undefined ? null : item[column];
  }
  return out;
}

async function nextId(table) {
  const result = await doc.send(new UpdateCommand({
    TableName: tableNames()[table],
    Key: { user_email: COUNTER_KEY, id: 0 },
    UpdateExpression: 'ADD #v :inc',
    ExpressionAttributeNames: { '#v': 'seq' },
    ExpressionAttributeValues: { ':inc': 1 },
    ReturnValues: 'UPDATED_NEW'
  }));
  return result.Attributes.seq;
}

async function queryAll(params) {
  const items = [];
  let startKey;
  do {
    const page = await doc.send(new QueryCommand({ ...params, ExclusiveStartKey: startKey }));
    items.push(...(page.Items || []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items.filter((item) => item.user_email !== COUNTER_KEY);
}

async function rowsByUser(table, userEmail) {
  return queryAll({
    TableName: tableNames()[table],
    KeyConditionExpression: 'user_email = :u',
    ExpressionAttributeValues: { ':u': userEmail }
  });
}

async function findById(table, id) {
  const owner = ownerCache[table].get(id);
  if (owner) {
    const result = await doc.send(new GetCommand({
      TableName: tableNames()[table],
      Key: { user_email: owner, id },
      ConsistentRead: true
    }));
    if (result.Item) return result.Item;
    return null;
  }

  // Fall back to the eventually-consistent GSI, with a short retry loop.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const items = await queryAll({
      TableName: tableNames()[table],
      IndexName: 'id-index',
      KeyConditionExpression: 'id = :id',
      ExpressionAttributeValues: { ':id': id }
    });
    if (items.length > 0) return items[0];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function deleteItems(table, items) {
  const name = tableNames()[table];
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25).map((item) => ({
      DeleteRequest: { Key: { user_email: item.user_email, id: item.id } }
    }));
    await doc.send(new BatchWriteCommand({ RequestItems: { [name]: batch } }));
    for (const item of items.slice(i, i + 25)) {
      ownerCache[table].delete(item.id);
    }
  }
}

async function cascadeDeleteWorkEntries(userEmail, clientId) {
  const entries = await rowsByUser('work_entries', userEmail);
  const orphans = clientId === undefined
    ? entries
    : entries.filter((entry) => entry.client_id === clientId);
  await deleteItems('work_entries', orphans);
}

// Emulated INNER JOIN: enrich with `client_name`, dropping rows whose client
// row no longer exists.
async function joinClientName(entries) {
  const names = new Map();
  const joined = [];
  for (const entry of entries) {
    if (!names.has(entry.client_id)) {
      const clientRow = await findById('clients', entry.client_id);
      names.set(entry.client_id, clientRow ? clientRow.name : null);
    }
    const name = names.get(entry.client_id);
    if (name === null) continue;
    joined.push({
      id: entry.id,
      client_id: entry.client_id,
      hours: entry.hours,
      description: entry.description === undefined ? null : entry.description,
      date: entry.date,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      client_name: name
    });
  }
  return joined;
}

function sortWorkEntries(rows) {
  return rows.sort((a, b) => (
    compare(b.date, a.date)
    || compare(b.created_at, a.created_at)
    || compare(b.id, a.id)
  ));
}

const CLIENT_COLUMNS = ['id', 'name', 'description', 'department', 'email', 'created_at', 'updated_at'];

function parseInsertColumns(sql) {
  const match = /INSERT INTO \w+ \(([^)]+)\)/i.exec(sql);
  return match ? match[1].split(',').map((column) => column.trim()) : [];
}

function parseSetClause(sql, params) {
  const match = /SET (.+) WHERE/i.exec(sql);
  const assignments = match[1].split(',').map((part) => part.trim());
  const updates = {};
  let index = 0;
  for (const assignment of assignments) {
    const [column, value] = assignment.split('=').map((part) => part.trim());
    if (value === '?') {
      updates[column] = params[index];
      index += 1;
    } else {
      updates[column] = currentTimestamp();
    }
  }
  return { updates, consumed: index };
}

async function applyUpdate(table, userEmail, id, updates) {
  const names = {};
  const values = {};
  const sets = [];
  Object.entries(updates).forEach(([column, value], i) => {
    names[`#k${i}`] = column;
    values[`:v${i}`] = value;
    sets.push(`#k${i} = :v${i}`);
  });

  try {
    await doc.send(new UpdateCommand({
      TableName: tableNames()[table],
      Key: { user_email: userEmail, id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(id)'
    }));
    return 1;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') return 0;
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Statement translation                                               */
/* ------------------------------------------------------------------ */

async function runSelectOne(sql, params) {
  const rows = await runSelectMany(sql, params);
  return rows.length > 0 ? rows[0] : undefined;
}

async function runSelectMany(sql, params) {
  const users = tableNames().users;

  // --- users -------------------------------------------------------
  if (sql.includes('FROM users WHERE email')) {
    const result = await doc.send(new GetCommand({
      TableName: users,
      Key: { email: params[0] },
      ConsistentRead: true
    }));
    if (!result.Item) return [];
    const columns = sql.includes('created_at') ? ['email', 'created_at'] : ['email'];
    return [pick(result.Item, columns)];
  }

  // --- work_entries (must be checked before plain clients matches) --
  if (sql.includes('FROM work_entries we')) {
    if (sql.includes('WHERE we.user_email = ?')) {
      const entries = await rowsByUser('work_entries', params[0]);
      const filtered = params.length > 1
        ? entries.filter((entry) => entry.client_id === params[1])
        : entries;
      return sortWorkEntries(await joinClientName(filtered));
    }
    if (sql.includes('WHERE we.id = ? AND we.user_email = ?')) {
      const result = await doc.send(new GetCommand({
        TableName: tableNames().work_entries,
        Key: { user_email: params[1], id: params[0] },
        ConsistentRead: true
      }));
      return result.Item ? joinClientName([result.Item]) : [];
    }
    if (sql.includes('WHERE we.id = ?')) {
      const entry = await findById('work_entries', params[0]);
      return entry ? joinClientName([entry]) : [];
    }
  }

  if (sql.includes('FROM work_entries WHERE id = ? AND user_email = ?')) {
    const result = await doc.send(new GetCommand({
      TableName: tableNames().work_entries,
      Key: { user_email: params[1], id: params[0] },
      ConsistentRead: true
    }));
    return result.Item ? [pick(result.Item, ['id'])] : [];
  }

  if (sql.includes('FROM work_entries WHERE client_id = ? AND user_email = ?')) {
    const entries = await queryAll({
      TableName: tableNames().work_entries,
      IndexName: 'client-index',
      KeyConditionExpression: 'client_id = :c',
      FilterExpression: 'user_email = :u',
      ExpressionAttributeValues: { ':c': params[0], ':u': params[1] },
      ScanIndexForward: false
    });
    const columns = sql.includes('SELECT id, hours')
      ? ['id', 'hours', 'description', 'date', 'created_at', 'updated_at']
      : ['hours', 'description', 'date', 'created_at'];
    return entries
      .sort((a, b) => compare(b.date, a.date) || compare(b.id, a.id))
      .map((entry) => pick(entry, columns));
  }

  // --- clients ------------------------------------------------------
  if (sql.includes('FROM clients WHERE user_email = ?')) {
    const rows = await rowsByUser('clients', params[0]);
    return rows
      .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id))
      .map((row) => pick(row, CLIENT_COLUMNS));
  }

  if (sql.includes('FROM clients WHERE id = ? AND user_email = ?')) {
    const result = await doc.send(new GetCommand({
      TableName: tableNames().clients,
      Key: { user_email: params[1], id: params[0] },
      ConsistentRead: true
    }));
    if (!result.Item) return [];
    let columns = CLIENT_COLUMNS;
    if (sql.startsWith('SELECT id FROM clients')) columns = ['id'];
    else if (sql.startsWith('SELECT id, name FROM clients')) columns = ['id', 'name'];
    return [pick(result.Item, columns)];
  }

  if (sql.includes('FROM clients WHERE id = ?')) {
    const row = await findById('clients', params[0]);
    return row ? [pick(row, CLIENT_COLUMNS)] : [];
  }

  throw new Error(`dynamoAdapter: unsupported SELECT statement: ${sql}`);
}

async function runStatement(sql, params) {
  // --- users --------------------------------------------------------
  if (sql.startsWith('INSERT INTO users')) {
    await doc.send(new PutCommand({
      TableName: tableNames().users,
      Item: { email: params[0], created_at: currentTimestamp() }
    }));
    return { lastID: 0, changes: 1 };
  }

  // --- inserts ------------------------------------------------------
  if (sql.startsWith('INSERT INTO clients') || sql.startsWith('INSERT INTO work_entries')) {
    const table = sql.startsWith('INSERT INTO clients') ? 'clients' : 'work_entries';
    const columns = parseInsertColumns(sql);
    const id = await nextId(table);
    const timestamp = currentTimestamp();
    const item = { id, created_at: timestamp, updated_at: timestamp };
    columns.forEach((column, index) => {
      item[column] = params[index];
    });
    await doc.send(new PutCommand({ TableName: tableNames()[table], Item: item }));
    ownerCache[table].set(id, item.user_email);
    return { lastID: id, changes: 1 };
  }

  // --- updates ------------------------------------------------------
  if (sql.startsWith('UPDATE clients SET') || sql.startsWith('UPDATE work_entries SET')) {
    const table = sql.startsWith('UPDATE clients') ? 'clients' : 'work_entries';
    const { updates, consumed } = parseSetClause(sql, params);
    const id = params[consumed];
    const userEmail = params[consumed + 1];
    const changes = await applyUpdate(table, userEmail, id, updates);
    return { lastID: 0, changes };
  }

  // --- deletes ------------------------------------------------------
  if (sql.startsWith('DELETE FROM work_entries WHERE id = ? AND user_email = ?')) {
    const result = await doc.send(new DeleteCommand({
      TableName: tableNames().work_entries,
      Key: { user_email: params[1], id: params[0] },
      ReturnValues: 'ALL_OLD'
    }));
    ownerCache.work_entries.delete(params[0]);
    return { lastID: 0, changes: result.Attributes ? 1 : 0 };
  }

  if (sql.startsWith('DELETE FROM clients WHERE id = ? AND user_email = ?')) {
    const result = await doc.send(new DeleteCommand({
      TableName: tableNames().clients,
      Key: { user_email: params[1], id: params[0] },
      ReturnValues: 'ALL_OLD'
    }));
    ownerCache.clients.delete(params[0]);
    await cascadeDeleteWorkEntries(params[1], params[0]);
    return { lastID: 0, changes: result.Attributes ? 1 : 0 };
  }

  if (sql.startsWith('DELETE FROM clients WHERE user_email = ?')) {
    const rows = await rowsByUser('clients', params[0]);
    await deleteItems('clients', rows);
    await cascadeDeleteWorkEntries(params[0]);
    return { lastID: 0, changes: rows.length };
  }

  throw new Error(`dynamoAdapter: unsupported statement: ${sql}`);
}

/* ------------------------------------------------------------------ */
/* sqlite3-compatible surface                                          */
/* ------------------------------------------------------------------ */

function splitArgs(paramsOrCallback, callback) {
  if (typeof paramsOrCallback === 'function') return { params: [], cb: paramsOrCallback };
  return { params: (paramsOrCallback || []).map(bindValue), cb: callback };
}

const adapter = {
  serialize(fn) {
    if (typeof fn === 'function') fn();
  },

  get(sql, paramsOrCallback, callback) {
    const { params, cb } = splitArgs(paramsOrCallback, callback);
    runSelectOne(normalize(sql), params).then(
      (row) => cb && cb(null, row),
      (error) => cb && cb(error)
    );
  },

  all(sql, paramsOrCallback, callback) {
    const { params, cb } = splitArgs(paramsOrCallback, callback);
    runSelectMany(normalize(sql), params).then(
      (rows) => cb && cb(null, rows),
      (error) => cb && cb(error)
    );
  },

  run(sql, paramsOrCallback, callback) {
    const { params, cb } = splitArgs(paramsOrCallback, callback);
    runStatement(normalize(sql), params).then(
      (result) => cb && cb.call({ lastID: result.lastID, changes: result.changes }, null),
      (error) => cb && cb.call({ lastID: 0, changes: 0 }, error)
    );
  },

  close(callback) {
    if (callback) callback(null);
  }
};

module.exports = { adapter, documentClient: doc, dynamoClient: client };
