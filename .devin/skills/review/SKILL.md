---
name: review
description: Review timesheet-app changes before committing
allowed-tools: [read, grep, glob, exec]
---

Review the current git diff:

1. Run `git diff` (and `git diff --staged` if there are staged changes).
2. Check backend changes for: parameterized SQL with `user_email` scoping, Joi validation on new inputs (`backend/src/validation/schemas.js`), the `{ error: ... }` / `{ workEntries: ... }` response envelope conventions.
3. Check frontend changes for: MUI components, TanStack Query for server state, strict TypeScript (no `any`).
4. Verify changed backend behavior is covered in `backend/src/__tests__/`; run `cd backend && npm test` and report failures.
5. Summarize findings as `severity — file:line — issue — suggested fix`, then give an overall verdict.
