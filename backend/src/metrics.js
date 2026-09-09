const client = require('prom-client');
const { getRoutePattern } = require('./middleware/requestContext');

const register = new client.Registry();

client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

const EXCLUDED_PATHS = new Set(['/health', '/metrics']);

function metricsMiddleware(req, res, next) {
  if (EXCLUDED_PATHS.has(req.path)) {
    return next();
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = {
      method: req.method,
      route: getRoutePattern(req),
      status_code: String(res.statusCode)
    };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, seconds);
  });

  next();
}

async function metricsHandler(req, res) {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  metricsMiddleware,
  metricsHandler
};
