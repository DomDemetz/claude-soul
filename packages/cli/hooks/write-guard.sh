#!/bin/bash
# Soul System Write Guard — blocks writes to auto-managed files
INPUT="${TOOL_INPUT:-}"
if echo "$INPUT" | grep -qE '\.soul/files/(STATE|FRAMEWORKS)\.md'; then
  echo "BLOCKED: STATE.md and FRAMEWORKS.md are auto-managed by the soul system." >&2
  exit 2
fi
