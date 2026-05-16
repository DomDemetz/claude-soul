#!/bin/bash
# Session Scratchpad — silently logs tool calls for within-session context persistence
# PostToolUse hook. Appends one structured line per tool call.
# Zero context cost: no stdout, no stderr back to Claude.
#
# The scratchpad resets per session (keyed by PPID).
# Claude reads /tmp/claude-scratchpad.md on demand when uncertain about prior actions.

SCRATCHPAD="/tmp/claude-scratchpad.md"
TIMESTAMP=$(date +%H:%M:%S)

# Read first 4KB of stdin (enough for tool_name + tool_input, avoids slurping large outputs)
INPUT=$(head -c 4096)

# Extract tool name
TOOL=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('tool_name', ''))
except:
    print('')
" 2>/dev/null)

[ -z "$TOOL" ] && exit 0

# Initialize scratchpad for new session
if ! grep -q "^# Session $PPID" "$SCRATCHPAD" 2>/dev/null; then
  echo "# Session $PPID — $(date '+%Y-%m-%d %H:%M')" > "$SCRATCHPAD"
  echo "" >> "$SCRATCHPAD"
fi

# Extract key details based on tool type
DETAIL=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    t = d.get('tool_name', '')
    i = d.get('tool_input', {})
    if t == 'Read':
        print(i.get('file_path', ''))
    elif t in ('Edit', 'Write'):
        print(i.get('file_path', ''))
    elif t == 'Grep':
        p = i.get('pattern', '')
        path = i.get('path', '.')
        print(f\"'{p}' in {path}\")
    elif t == 'Glob':
        p = i.get('pattern', '')
        path = i.get('path', '.')
        print(f\"'{p}' in {path}\")
    elif t == 'Bash':
        cmd = i.get('command', '')[:120]
        print(cmd)
    elif t == 'Agent':
        print(i.get('description', i.get('prompt', '')[:80]))
    else:
        # For any other tool, try to get a useful summary
        s = str(i)[:100]
        print(s if len(s) > 2 else '')
except:
    print('')
" 2>/dev/null)

# Append entry
if [ -n "$DETAIL" ]; then
  echo "[$TIMESTAMP] $TOOL — $DETAIL" >> "$SCRATCHPAD"
else
  echo "[$TIMESTAMP] $TOOL" >> "$SCRATCHPAD"
fi

exit 0
