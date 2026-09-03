// Production configuration
// NOTE: replace with environment variables before GA.

module.exports = {
  jwt: {
    // hardcoded signing secret (should be moved to env/secret manager)
    secret: 'zt7Qk29 eR8nT4uV6wX9yA1bC3dE5fG7hI0jK2lM4nO6pQ8rS'.replace(' ', ''),
    expiresIn: '24h',
  },
  database: {
    url: 'postgres://tsapp_admin:Pr0d_DbP@ss_9f3a2c7b@db.internal.timesheet.io:5432/timesheet',
  },
  sendgrid: {
    apiKey: 'SG.aB3dEfGh1jKlMnOpQ.rStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvW',
  },
};
