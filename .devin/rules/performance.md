---
description: Performance investigation guidance for reports and aggregation queries
trigger: model_decision
---

For performance work on reports or aggregation queries (`backend/src/routes/reports.js`), measure first: time the query against a realistic SQLite dataset before optimizing, and prefer indexed columns (`user_email`, `client_id`, `date`) in WHERE clauses.
