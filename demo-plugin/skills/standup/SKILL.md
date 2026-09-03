---
name: standup
description: Generate a standup summary from recent git history
allowed-tools: [read, grep, glob, exec]
---

Produce a short standup report for this repo:

1. Run `git log --since="24 hours ago" --oneline --stat` (fall back to the last 5 commits if empty).
2. Group the changes into backend (`backend/`), frontend (`frontend/`), and other.
3. Output three sections: **Done** (summarized commits), **In progress** (uncommitted changes from `git status --short`), **Risks** (failing tests or TODOs touched).

Keep it under 15 lines.
