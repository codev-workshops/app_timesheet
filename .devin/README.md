# Devin Desktop / CLI demo artifacts

Everything Devin Local (Devin Desktop and the Devin CLI) discovers automatically in this repo:

| Artifact | Location | What it demos |
| --- | --- | --- |
| Always-on rules | `AGENTS.md` (root), `frontend/AGENTS.md` (directory-scoped) | Project conventions injected into every session |
| Triggered rules | `.devin/rules/sql-safety.md` (glob), `.devin/rules/performance.md` (model decision) | Rules activated only when relevant |
| Skills | `.devin/skills/review/`, `.devin/skills/security-audit/` | `/review` and `/security-audit` slash commands; security-audit runs as a read-only subagent |
| Custom subagents | `.devin/agents/backend-worker.md`, `frontend-worker.md`, `tester.md`, `reviewer.md` | Scoped worker profiles with `allowed-tools` restrictions (requires the "Subagents (Preview)" toggle) |
| Hooks | `.devin/hooks.v1.json` + `scripts/check-command.sh` | PreToolUse policy hook that blocks destructive shell commands |
| MCP servers | `.devin/mcp_config.json` | Project-scoped DeepWiki MCP server (personal overrides go in the gitignored `.devin/mcp_config.local.json`) |
| Plugin | `demo-plugin/` | Install with `devin plugins install ./demo-plugin`, then run `/timesheet-tools:standup` |

## Quick demo prompts

- Rules: "Add a new field to the clients endpoint" → watch the SQL safety rule activate.
- Skills: `/review` after making a change; `/security-audit` for a read-only audit.
- Subagents: "Run the backend test suite using the tester subagent and summarize the results."
- Hooks: ask Devin to run `git reset --hard` → the hook blocks it.
- Plugin: `devin plugins install ./demo-plugin` then `/timesheet-tools:standup`.

Personal, uncommitted overrides: `AGENTS.local.md` and `.devin/mcp_config.local.json` (both gitignored).
