/**
 * Terminal Express error-handling middleware (4-arity signature), registered
 * last in server.js so that anything passed to `next(err)` ends up here.
 *
 * @description
 * Maps errors to JSON responses in priority order:
 * 1. Joi validation errors (`err.isJoi === true`) -> 400
 *    `{ error: 'Validation error', details: string[] }` where `details` is the
 *    list of Joi `detail.message` strings. Route handlers rely on this by calling
 *    `next(error)` with the raw Joi error instead of formatting it themselves.
 * 2. SQLite errors (`err.code` starts with `SQLITE_`) -> 500
 *    `{ error: 'Database error', message: 'An error occurred while processing your request' }`.
 *    The driver message is deliberately not echoed so schema details do not leak.
 * 3. Anything else -> `err.status || 500` with `{ error: err.message || 'Internal server error' }`.
 *
 * Every error is also logged via `console.error` before responding.
 *
 * Note: most route handlers respond to DB callback errors directly with
 * `res.status(500)` rather than calling `next(err)`, so branch 2 is mostly
 * reached for errors thrown synchronously inside a handler's `try` block.
 *
 * @param {Error & {isJoi?: boolean, details?: Array<{message: string}>, code?: string, status?: number}} err
 *   Error forwarded via `next(err)`.
 * @param {import('express').Request} req - Unused; required for Express to treat this as an error handler.
 * @param {import('express').Response} res - Response the JSON error body is written to.
 * @param {import('express').NextFunction} next - Unused; the handler always terminates the request.
 * @returns {void}
 */
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Joi validation errors
  if (err.isJoi) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.details.map(detail => detail.message)
    });
  }

  // SQLite errors
  if (err.code && err.code.startsWith('SQLITE_')) {
    return res.status(500).json({
      error: 'Database error',
      message: 'An error occurred while processing your request'
    });
  }

  // Default error
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
}

module.exports = {
  errorHandler
};
