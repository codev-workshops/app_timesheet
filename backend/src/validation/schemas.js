const Joi = require('joi');

const clientSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  department: Joi.string().trim().max(255).optional().allow(''),
  email: Joi.string().trim().email().max(255).optional().allow('')
});

const workEntrySchema = Joi.object({
  clientId: Joi.number().integer().positive().required(),
  hours: Joi.number().positive().max(24).precision(2).required(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  date: Joi.date().iso().required()
});

const updateWorkEntrySchema = Joi.object({
  clientId: Joi.number().integer().positive().optional(),
  hours: Joi.number().positive().max(24).precision(2).optional(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  date: Joi.date().iso().optional()
}).min(1); // At least one field must be provided

const WORK_ENTRY_LIST_DEFAULT_LIMIT = 50;
const WORK_ENTRY_LIST_MAX_LIMIT = 200;

const workEntryListQuerySchema = Joi.object({
  clientId: Joi.number().integer().positive().optional(),
  limit: Joi.number().integer().min(1).max(WORK_ENTRY_LIST_MAX_LIMIT).default(WORK_ENTRY_LIST_DEFAULT_LIMIT),
  offset: Joi.number().integer().min(0).default(0)
});

const updateClientSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).optional(),
  description: Joi.string().trim().max(1000).optional().allow(''),
  department: Joi.string().trim().max(255).optional().allow(''),
  email: Joi.string().trim().email().max(255).optional().allow('')
}).min(1); // At least one field must be provided

const emailSchema = Joi.object({
  email: Joi.string().email().required()
});

module.exports = {
  clientSchema,
  workEntrySchema,
  updateWorkEntrySchema,
  workEntryListQuerySchema,
  WORK_ENTRY_LIST_DEFAULT_LIMIT,
  WORK_ENTRY_LIST_MAX_LIMIT,
  updateClientSchema,
  emailSchema
};
