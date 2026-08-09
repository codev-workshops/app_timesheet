const express = require('express');
const crypto = require('crypto');
const { authenticateUser } = require('../middleware/auth');
const { getDatabase } = require('../database/init');
const { reportJobSchema } = require('../validation/schemas');
const store = require('../reports/jobStore');
const { sendReportJob } = require('../reports/queue');

const router = express.Router();
router.use(authenticateUser);

function query(method, sql, params) {
  return new Promise((resolve, reject) => {
    getDatabase()[method](sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

router.post('/', async (req, res, next) => {
  try {
    const { error, value } = reportJobSchema.validate(req.body);
    if (error) return next(error);
    const clientId = parseInt(value.clientId);
    if (isNaN(clientId)) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }
    const client = await query('get',
      'SELECT id, name FROM clients WHERE id = ? AND user_email = ?',
      [clientId, req.userEmail]);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const job = {
      id: crypto.randomUUID(), ownerEmail: req.userEmail, clientId,
      format: value.format, status: 'queued', resultLocation: null, error: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    store.create(job);
    await sendReportJob({ jobId: job.id });
    return res.status(202).json({ jobId: job.id, status: job.status });
  } catch (error) {
    return next(error);
  }
});

router.get('/:jobId', (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.jobId)) {
    return res.status(404).json({ error: 'Job not found' });
  }
  const job = store.get(req.params.jobId);
  if (!job || job.ownerEmail !== req.userEmail) return res.status(404).json({ error: 'Job not found' });
  res.json({
    jobId: job.id, status: job.status, format: job.format, clientId: job.clientId,
    ...(job.resultLocation ? { resultLocation: job.resultLocation } : {}),
    ...(job.error ? { error: job.error } : {})
  });
});

module.exports = router;
