/**
 * @fileoverview Placeholder "production" configuration object.
 *
 * IMPORTANT: this module is NOT required by any runtime code (server.js,
 * routes, middleware, or database/init.js). Its existence does not change how
 * the backend behaves:
 * - `jwt.*` is unused. The backend performs no JWT signing or verification;
 *   authentication is the trust-based `x-user-email` header (see
 *   middleware/auth.js). The `jsonwebtoken` dependency in package.json is
 *   declared but never imported.
 * - `database.url` is unused. The backend always opens an in-memory SQLite
 *   database (`:memory:`, see database/init.js); no Postgres connection is made.
 * - `sendgrid.apiKey` is unused. Nothing in the backend sends email.
 *
 * The literal values here are hard-coded secrets checked into source control
 * and should be treated as compromised placeholders, to be replaced by
 * environment variables / a secret manager if this config is ever wired in.
 *
 * @type {{
 *   jwt: { secret: string, expiresIn: string },
 *   database: { url: string },
 *   sendgrid: { apiKey: string }
 * }}
 */
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
