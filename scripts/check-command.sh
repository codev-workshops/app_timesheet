#!/usr/bin/env bash
# PreToolUse hook: blocks destructive shell commands.
# Receives the event as JSON on stdin; a non-zero exit blocks the action.

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

blocked='rm -rf|drop table|truncate table|git push --force|git reset --hard'

if printf '%s' "$command" | grep -qiE "$blocked"; then
  echo "Blocked by policy hook: destructive command detected." >&2
  exit 1
fi

exit 0
