const fs = require('fs');
const path = require('path');

function directory() {
  return process.env.REPORT_JOBS_DIR || path.join(__dirname, '../../temp/report-jobs');
}

function jobPath(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  return path.join(directory(), `${id}.json`);
}

function writeAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

function create(job) {
  writeAtomically(jobPath(job.id), job);
  return job;
}

function get(id) {
  const file = jobPath(id);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function patchStatus(id, changes) {
  const job = get(id);
  if (!job) return null;
  const updated = { ...job, ...changes, updatedAt: new Date().toISOString() };
  writeAtomically(jobPath(id), updated);
  return updated;
}

module.exports = { create, get, patchStatus };
