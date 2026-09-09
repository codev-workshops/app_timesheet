const Joi = require('joi');

/**
 * Body schema for creating a client.
 *
 * `name` is the only required field because it is the sole column the UI and
 * reports render unconditionally; the rest are optional metadata. Strings are
 * trimmed so whitespace-only input cannot satisfy `min(1)`, and `allow('')`
 * lets the frontend submit cleared form fields (which the handlers convert to
 * NULL) instead of having to omit the keys. The `max` lengths guard against
 * unbounded text being stored in the in-memory database and blowing up PDF/CSV
 * exports.
 */
const clientSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  department: Joi.string().trim().max(255).optional().allow(''),
  email: Joi.string().trim().email().max(255).optional().allow('')
});

/**
 * Body schema for creating a work entry.
 *
 * `clientId` must be a positive integer so the ownership lookup in the handler
 * gets a usable key; foreign keys are not enforced by SQLite here, so that
 * lookup is the real integrity check. `hours` is capped at 24 (one entry
 * represents one day of work) with two decimals to match the
 * `DECIMAL(5,2)` column, and `date` must be ISO-8601 so string comparison in
 * the date-ordered report queries stays correct.
 */
const workEntrySchema = Joi.object({
  clientId: Joi.number().integer().positive().required(),
  hours: Joi.number().positive().max(24).precision(2).required(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  date: Joi.date().iso().required()
});

/**
 * Body schema for partial work-entry updates.
 *
 * Every field is optional so callers can PATCH-style send just what changed —
 * the handler builds its UPDATE from whichever keys survive validation — but
 * `.min(1)` rejects an empty body, which would otherwise produce a no-op
 * UPDATE that only bumped `updated_at`.
 */
const updateWorkEntrySchema = Joi.object({
  clientId: Joi.number().integer().positive().optional(),
  hours: Joi.number().positive().max(24).precision(2).optional(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  date: Joi.date().iso().optional()
}).min(1); // At least one field must be provided

/**
 * Body schema for partial client updates.
 *
 * Mirrors {@link clientSchema} but with `name` optional, since a rename is only
 * one of several possible edits; `.min(1)` still blocks an empty body for the
 * same reason as {@link updateWorkEntrySchema}.
 */
const updateClientSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).optional(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  department: Joi.string().trim().max(255).optional().allow(''),
  email: Joi.string().trim().email().max(255).optional().allow('')
}).min(1); // At least one field must be provided

/**
 * Body schema for the login endpoint — an email and nothing else.
 *
 * There is no password field to validate: the email alone identifies the user
 * (see the `x-user-email` model in the auth middleware). Joi's `email()` rule
 * is stricter than the middleware's regex, so a malformed address is rejected
 * before it can be auto-inserted into `users`.
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
