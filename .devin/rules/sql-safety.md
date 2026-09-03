---
description: SQL safety rules for backend routes
trigger: glob
globs: "backend/src/routes/**"
---

Never interpolate values into SQL strings. Use `?` placeholders and always include `user_email = ?` in WHERE clauses so data stays isolated per user.
