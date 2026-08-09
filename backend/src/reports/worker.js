const { receiveReportJobs, deleteReportJob } = require('./queue');
const store = require('./jobStore');
const { loadReportData } = require('./data');
const { generate } = require('./generator');
const { putArtifact } = require('./artifactStore');

async function processMessage(message) {
  const payload = JSON.parse(message.Body);
  const job = store.get(payload.jobId);
  if (!job || job.status === 'done') {
    await deleteReportJob(message);
    return job;
  }
  try {
    store.patchStatus(job.id, { status: 'processing' });
    const data = await loadReportData(job.clientId, job.ownerEmail);
    if (!data) throw new Error('Client not found');
    const bytes = await generate(job.format, data);
    const extension = job.format === 'csv' ? 'csv' : 'pdf';
    const location = await putArtifact(`${job.id}.${extension}`, bytes,
      job.format === 'csv' ? 'text/csv' : 'application/pdf');
    const done = store.patchStatus(job.id, { status: 'done', resultLocation: location });
    await deleteReportJob(message);
    return done;
  } catch (error) {
    const failed = store.patchStatus(job.id, { status: 'failed', error: error.message });
    await deleteReportJob(message);
    return failed;
  }
}

async function drainOnce({ maxMessages = 1, waitTimeSeconds = 0 } = {}) {
  const messages = await receiveReportJobs(maxMessages, waitTimeSeconds);
  const processed = [];
  for (const message of messages) processed.push(await processMessage(message));
  return processed;
}

async function runWorker(options) {
  while (true) {
    try {
      await drainOnce(options);
    } catch (error) {
      console.error('Report worker iteration failed:', error);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

module.exports = { drainOnce, runWorker };
