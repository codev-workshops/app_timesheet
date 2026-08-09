const { getDatabase } = require('../database/init');

function query(method, sql, params) {
  return new Promise((resolve, reject) => {
    getDatabase()[method](sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

async function loadReportData(clientId, userEmail) {
  const client = await query('get',
    'SELECT id, name FROM clients WHERE id = ? AND user_email = ?',
    [clientId, userEmail]);
  if (!client) return null;
  const workEntries = await query('all',
    `SELECT hours, description, date, created_at
     FROM work_entries
     WHERE client_id = ? AND user_email = ?
     ORDER BY date DESC`,
    [clientId, userEmail]);
  return { client, workEntries };
}

module.exports = { loadReportData };
