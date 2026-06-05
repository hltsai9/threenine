#!/usr/bin/env bash
# SessionStart hook — if the session started behind the pushed tip (e.g. on a stale container
# snapshot), fast-forward this branch to its upstream automatically.
#
# Strictly safe: it ONLY fast-forwards when (a) the working tree is clean and (b) HEAD is an
# ancestor of the upstream (no local commits, no divergence). Offline / dirty / ahead / diverged
# → it does nothing. Never resets, never discards work.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"
[ -n "$upstream" ] || exit 0

# Best-effort fetch; offline → skip silently.
git fetch --quiet "${upstream%%/*}" "${upstream#*/}" 2>/dev/null || exit 0

[ "$(git rev-parse HEAD 2>/dev/null)" != "$(git rev-parse '@{u}' 2>/dev/null)" ] || exit 0

# Only act when strictly behind (HEAD is an ancestor of upstream) AND the tree is clean.
if git merge-base --is-ancestor HEAD '@{u}' 2>/dev/null && [ -z "$(git status --porcelain 2>/dev/null)" ]; then
  if git merge --ff-only '@{u}' >/dev/null 2>&1; then
    printf '{"systemMessage":"Synced %s to origin (fast-forwarded to %s) — this session started behind the pushed tip."}' \
      "$branch" "$(git rev-parse --short HEAD)"
  fi
fi
exit 0
