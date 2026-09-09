/**
 * Terminal Express error handler that maps internal failures onto a single
 * `{ error }` response shape the frontend can rely on.
 *
 * Route handlers forward Joi validation errors here with `next(error)` instead
 * of formatting them inline, which is why Joi is recognised first and turned
 * into a 400 with per-field messages. SQLite errors are deliberately flattened
 * into a generic 500 message: driver text can leak table and column names, so
 * the detail stays in the server log only. Anything else honours an explicit
 * `err.status` if one was attached, defaulting to 500.
 *
 * @param {Error & {isJoi?: boolean, details?: Array<{message: string}>, code?: string, status?: number}} err Error raised upstream.
 * @param {import('express').Request} req Unused; present so Express treats this as an error handler (4-arity).
 * @param {import('express').Response} res Receives the JSON error response.
 * @param {import('express').NextFunction} next Unused, for the same arity reason.
 * @returns {void} Sends `{ error, details? }` or `{ error, message }` for database errors.
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

  // Never surface raw driver text to clients: it can disclose schema details.
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
