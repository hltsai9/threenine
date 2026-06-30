#!/usr/bin/env bash
# Stop hook — keep docs/RELEASE_NOTES.md in step with code changes.
#
# Fires when Claude finishes a turn. If code under frontend/, local/, backend/, or deploy/ has
# changed (either in commits not yet pushed to the upstream branch, or uncommitted in the tree) but
# docs/RELEASE_NOTES.md is NOT among those changes, it blocks the stop and asks Claude to add a
# release-note entry. Honors stop_hook_active so it never loops, and no-ops outside a git repo.
# Disable any time via /hooks.

input="$(cat)"

# Already triggered once this stop → let the turn end (prevents infinite loops).
case "$input" in
  *'"stop_hook_active": true'*|*'"stop_hook_active":true'*) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"
changed="$(
  {
    [ -n "$upstream" ] && git diff --name-only "$upstream" HEAD 2>/dev/null
    git status --porcelain=v1 2>/dev/null | sed 's/^...//; s/.* -> //'
  } | sort -u
)"

printf '%s\n' "$changed" | grep -Eq '^(frontend|local|backend|deploy)/' && code=1 || code=
printf '%s\n' "$changed" | grep -Eq '^docs/RELEASE_NOTES\.md$' && note=1 || note=

if [ -n "$code" ] && [ -z "$note" ]; then
  printf '%s' '{"decision":"block","reason":"You changed code under frontend/, local/, backend/, or deploy/ but did not update docs/RELEASE_NOTES.md. Add a brief entry under today'"'"'s date describing what changed and commit it before finishing. If this change genuinely needs no release note (e.g. a pure test/doc tweak), tell the user why instead of looping."}'
fi
exit 0
