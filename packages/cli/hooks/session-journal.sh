#!/bin/bash
# Session Journal Hook
# Captures a structured summary after every Claude Code conversation.
# Appends to a daily journal file at ~/.soul/journals/YYYY-MM-DD.md
#
# Input (stdin): JSON with session_id, transcript_path, cwd

INPUT=$(cat)
TRANSCRIPT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('transcript_path',''))" 2>/dev/null)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null)
SESSION=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id','')[:8])" 2>/dev/null)

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  exit 0
fi

# Create journal directory
JOURNAL_DIR="$HOME/.soul/journals"
mkdir -p "$JOURNAL_DIR"

# Daily journal file
TODAY=$(date +%Y-%m-%d)
JOURNAL="$JOURNAL_DIR/$TODAY.md"

# If this is the first entry today, add a header
if [ ! -f "$JOURNAL" ]; then
  echo "# Journal — $TODAY" > "$JOURNAL"
fi

# Extract conversation: sample from beginning, middle, and end for coverage
TAIL=$(python3 -c "
import sys, json

lines = []
with open('$TRANSCRIPT', 'r') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            msg_type = obj.get('type', '')
            if msg_type in ('user', 'assistant'):
                msg = obj.get('message', obj)
                role = msg.get('role', msg_type)
                content = msg.get('content', '')
                if isinstance(content, list):
                    content = ' '.join(
                        c.get('text', '') for c in content if c.get('type') == 'text'
                    )
                if content and len(content) > 10:
                    clean = ' '.join(content.split())[:200]
                    lines.append(f'  {role}: {clean}')
        except:
            pass

# Sample for coverage: first 3, middle 3, last 6
if len(lines) <= 12:
    for l in lines:
        print(l)
else:
    for l in lines[:3]:
        print(l)
    print('  ...')
    mid = len(lines) // 2
    for l in lines[mid-1:mid+2]:
        print(l)
    print('  ...')
    for l in lines[-6:]:
        print(l)
" 2>/dev/null)

# Only write if we captured something
if [ -z "$TAIL" ]; then
  exit 0
fi

# Get project name from CWD (last path component)
PROJECT="${CWD##*/}"

# Capture git context if in a repo
GIT_SECTION=""
if git -C "$CWD" rev-parse --git-dir >/dev/null 2>&1; then
  # Files changed (diff --stat vs last commit)
  GIT_DIFF=$(git -C "$CWD" diff --stat HEAD 2>/dev/null | tail -6)
  # If nothing uncommitted, show what was committed this session
  if [ -z "$GIT_DIFF" ]; then
    GIT_DIFF=$(git -C "$CWD" diff --stat HEAD~1 2>/dev/null | tail -6)
  fi
  # Recent commits
  GIT_LOG=$(git -C "$CWD" log --oneline -3 2>/dev/null)

  if [ -n "$GIT_DIFF" ] || [ -n "$GIT_LOG" ]; then
    GIT_SECTION=$'\n  git:\n'
    [ -n "$GIT_LOG" ] && GIT_SECTION+="    commits: $(echo "$GIT_LOG" | head -3 | sed 's/^/    /')"$'\n'
    [ -n "$GIT_DIFF" ] && GIT_SECTION+="    changed:"$'\n'"$(echo "$GIT_DIFF" | sed 's/^/    /')"$'\n'
  fi
fi

# Append entry
{
  echo ""
  echo "## $(date +%H:%M) — ${PROJECT} [$SESSION]"
  echo ""
  echo "$TAIL"
  echo "$GIT_SECTION"
  echo ""
} >> "$JOURNAL"

exit 0
