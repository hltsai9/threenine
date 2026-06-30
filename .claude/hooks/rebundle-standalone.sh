#!/usr/bin/env bash
# PostToolUse hook — keep frontend/standalone.html in sync with the modular sources.
#
# Fires after Edit/Write/MultiEdit. If the edited file is a bundled frontend source, it
# regenerates standalone.html via frontend/bundle.mjs. Ignores edits to the generated
# standalone.html itself (no loop) and no-ops if node is unavailable or the file isn't a
# bundled source. Disable any time via /hooks.

input="$(cat)"

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
command -v node >/dev/null 2>&1 || exit 0

# Pull the edited file path out of the tool payload (tool_input.file_path / tool_input.filePath).
file="$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
[ -n "$file" ] || file="$(printf '%s' "$input" | sed -n 's/.*"filePath"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
[ -n "$file" ] || exit 0

base="$(basename "$file")"

# Only the bundled sources matter; standalone.html is the OUTPUT — never rebuild on its edits.
case "$file" in
  *standalone.html) exit 0 ;;
esac
case "$file" in
  */frontend/* | frontend/*) : ;;
  *) exit 0 ;;
esac
case "$base" in
  app.js|styles.css|data.js|shifts.js|owners.js|config.js|tour.js|index.html|favicon.svg) : ;;
  *) exit 0 ;;
esac

if node frontend/bundle.mjs >/dev/null 2>&1; then
  printf '%s' '{"systemMessage":"Rebuilt frontend/standalone.html from the modular sources (PostToolUse hook)."}'
fi
exit 0
