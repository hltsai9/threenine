#!/usr/bin/env bash
# Stop hook — run the test suite before finishing when code changed.
#
# Companion to release-note-reminder.sh. If anything under prototype/ or backend/ has changed
# (committed-not-pushed or uncommitted) it runs prototype/tests/run.cjs; on failure it blocks the
# stop with the failing output so Claude fixes it before finishing. Honors stop_hook_active so it
# nudges once and never loops; no-ops outside a git repo or when node is missing. Disable via /hooks.

input="$(cat)"

# Already continuing from a stop hook → let the turn end (prevents loops).
case "$input" in
  *'"stop_hook_active": true'*|*'"stop_hook_active":true'*) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"
changed="$(
  {
    [ -n "$upstream" ] && git diff --name-only "$upstream" HEAD 2>/dev/null
    git status --porcelain=v1 2>/dev/null | sed 's/^...//; s/.* -> //'
  } | sort -u
)"

printf '%s\n' "$changed" | grep -Eq '^(prototype|backend)/' || exit 0

out="$(node prototype/tests/run.cjs 2>&1)"
if [ $? -ne 0 ]; then
  # Compact the output to a single JSON-safe line for the block reason.
  summary="$(printf '%s' "$out" | tail -20 | tr '\n' ' ' | tr '"' "'" | sed 's/\\/\//g')"
  printf '{"decision":"block","reason":"Tests fail (node prototype/tests/run.cjs) — fix before finishing: %s"}' "$summary"
fi
exit 0
