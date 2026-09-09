const logger = require('../logger');
const { getRoutePattern } = require('./requestContext');

const SKIP_PATHS = new Set(['/health']);

function requestLogger(req, res, next) {
  if (SKIP_PATHS.has(req.path)) {
    return next();
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('request completed', {
      method: req.method,
      path: req.originalUrl,
      route: getRoutePattern(req),
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });

  next();
}

module.exports = { requestLogger };
