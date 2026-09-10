/**
 * @fileoverview Joi request-body schemas for the backend API.
 *
 * Route handlers call `schema.validate(req.body)` and forward any Joi error to
 * `next()`, where middleware/errorHandler.js turns it into a 400
 * `{ error: 'Validation error', details: string[] }` response. Schemas validate
 * only the body; path/query IDs are checked with `parseInt` in the handlers, and
 * the identity header is handled by middleware/auth.js.
 */
const Joi = require('joi');

/**
 * Body schema for `POST /api/clients`.
 *
 * @description
 * - `name`        string, trimmed, 1-255 chars, required
 * - `description` string, trimmed, <= 1000 chars, optional, `''` allowed
 * - `department`  string, trimmed, <= 255 chars, optional, `''` allowed
 * - `email`       valid email, trimmed, <= 255 chars, optional, `''` allowed
 *
 * Empty strings are accepted so form submissions with blank optional fields
 * pass validation; the route converts falsy values to `NULL` before insert.
 * Unknown keys are rejected (Joi default).
 *
 * @type {Joi.ObjectSchema}
 */
const clientSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  department: Joi.string().trim().max(255).optional().allow(''),
  email: Joi.string().trim().email().max(255).optional().allow('')
});

/**
 * Body schema for `POST /api/work-entries`.
 *
 * @description
 * - `clientId`    positive integer, required (ownership is checked separately in the route)
 * - `hours`       positive number, <= 24, at most 2 decimal places, required
 * - `description` string, trimmed, <= 1000 chars, optional, `''` allowed
 * - `date`        ISO-8601 date string, required; Joi converts it to a `Date`
 *
 * The 24-hour cap reflects "hours worked in a single day" semantics. Note that
 * `precision(2)` rounds rather than rejects extra decimals when `convert` is on
 * (the default).
 *
 * @type {Joi.ObjectSchema}
 */
const workEntrySchema = Joi.object({
  clientId: Joi.number().integer().positive().required(),
  hours: Joi.number().positive().max(24).precision(2).required(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  date: Joi.date().iso().required()
});

/**
 * Body schema for `PUT /api/work-entries/:id` (partial update).
 *
 * @description
 * Same field rules as {@link workEntrySchema} but every field is optional, and
 * `.min(1)` requires at least one key so an empty body is rejected with 400
 * instead of producing a no-op `UPDATE ... SET updated_at = CURRENT_TIMESTAMP`.
 *
 * @type {Joi.ObjectSchema}
 */
const updateWorkEntrySchema = Joi.object({
  clientId: Joi.number().integer().positive().optional(),
  hours: Joi.number().positive().max(24).precision(2).optional(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  date: Joi.date().iso().optional()
}).min(1); // At least one field must be provided

/**
 * Body schema for `PUT /api/clients/:id` (partial update).
 *
 * @description
 * Same field rules as {@link clientSchema} but `name` is optional too, and
 * `.min(1)` requires at least one key so an empty body is rejected with 400.
 *
 * @type {Joi.ObjectSchema}
 */
const updateClientSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).optional(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  department: Joi.string().trim().max(255).optional().allow(''),
  email: Joi.string().trim().email().max(255).optional().allow('')
}).min(1); // At least one field must be provided

/**
 * Body schema for `POST /api/auth/login`.
 *
 * @description
 * `{ email: string }` where `email` must be a valid address. This is the only
 * credential the app knows about; there is no password field because the
 * backend has no password or token verification (identity is the trust-based
 * `x-user-email` header on subsequent requests). Unlike the client/work-entry
 * schemas this one does not `trim()`.
 *
 * @type {Joi.ObjectSchema}
 */
const emailSchema = Joi.object({
  email: Joi.string().email().required()
});

module.exports = {
  clientSchema,
  workEntrySchema,
  updateWorkEntrySchema,
  updateClientSchema,
  emailSchema
};
