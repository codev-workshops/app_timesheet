const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const workEntryRoutes = require('./routes/workEntries');
const reportRoutes = require('./routes/reports');

const { initializeDatabase } = require('./database/init');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware order matters and is deliberate: security headers and CORS first
// (so rejected cross-origin requests never reach application code), then rate
// limiting, then logging, then body parsing, and finally the routes.

app.use(helmet());

// CORS is locked to the single frontend origin because authentication is a
// plain `x-user-email` header rather than a token: any page allowed to call
// this API can impersonate the user, so the allow-list stays narrow.
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// GLOBAL rate limit — 100 requests per IP per 15 minutes across every route,
// not just /api/auth/login. It is mounted before the routers so exports and
// report queries count against the same budget, which is worth knowing when a
// UI session suddenly starts receiving 429s.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Logging
app.use(morgan('combined'));

// 10mb bodies are generous for this API's payloads; the headroom exists so
// bulk work-entry submissions are not rejected by the default 100kb limit.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/**
 * Liveness probe. Deliberately mounted outside `/api` and before the routers so
 * it needs no `x-user-email` header and does not depend on the database.
 *
 * @returns {void} 200 with `{ status: 'OK', timestamp }`.
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Route mounting. Only /api/auth is public (its /login creates users); the
// other three routers apply `authenticateUser` themselves, so every path below
// them is user-scoped.
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/work-entries', workEntryRoutes);
app.use('/api/reports', reportRoutes);

// The error handler precedes the catch-all: `next(err)` from a router must
// reach it, and a 404 is only correct once no route (and no error) matched.
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

/**
 * Creates the schema before accepting traffic and then listens on `PORT`.
 *
 * The order is required, not cosmetic: the database is in-memory, so nothing
 * survives from a previous run and the very first request would hit missing
 * tables if the listener opened first. A failure here is fatal (`exit(1)`)
 * because an API with no schema can only serve 500s.
 *
 * @returns {Promise<void>} Resolves once the server is listening.
 */
async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Exported so supertest can drive the app in-process without binding a port.
module.exports = app;
