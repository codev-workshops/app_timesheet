const winston = require('winston');
const { getRequestContext } = require('./middleware/requestContext');

const injectRequestContext = winston.format((info) => {
  const { requestId, userEmail } = getRequestContext();
  if (requestId) info.requestId = requestId;
  if (userEmail) info.userEmail = userEmail;
  return info;
});

// Error objects have non-enumerable message/stack; serialize them explicitly.
const serializeError = winston.format((info) => {
  if (info.err instanceof Error) {
    const { message, stack, code, errno } = info.err;
    info.err = { message, stack, ...(code !== undefined && { code }), ...(errno !== undefined && { errno }) };
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    injectRequestContext(),
    serializeError(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error']
    })
  ]
});

module.exports = logger;
