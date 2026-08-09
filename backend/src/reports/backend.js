function isSqsReportsBackend() {
  return (process.env.REPORTS_BACKEND || 'sync').toLowerCase() === 'sqs';
}

module.exports = { isSqsReportsBackend };
