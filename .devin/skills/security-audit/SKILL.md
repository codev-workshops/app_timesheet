---
name: security-audit
description: Read-only security audit of the timesheet-app backend
allowed-tools: [read, grep, glob]
subagent: true
---

Audit the backend for security issues without modifying or executing anything:

1. SQL injection — every query in `backend/src/routes/` must use `?` placeholders; flag any string interpolation into SQL.
2. User isolation — every SELECT/UPDATE/DELETE must scope by `user_email`; flag queries that skip it.
3. Authentication — every route file except `auth.js` must apply the `authenticateUser` middleware.
4. Validation — request bodies must be validated with the Joi schemas in `backend/src/validation/schemas.js`.
5. Secrets — flag any hard-coded tokens, keys, or credentials.

Report findings as `severity — file:line — issue — suggested fix`. Do not attempt fixes.
