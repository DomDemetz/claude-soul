#!/bin/bash
# Check Follow-ups — surfaces unresolved follow-ups from previous sessions.
# Called manually or at session start. Outputs to stdout so Claude sees it.

FOLLOW_UPS="$HOME/.soul/data/follow-ups.json"

if [ ! -f "$FOLLOW_UPS" ]; then
  exit 0
fi

# Check for unresolved follow-ups
UNRESOLVED=$(python3 -c "
import json, sys
try:
    data = json.loads(open('$FOLLOW_UPS').read())
    unresolved = [f for f in data if not f.get('resolved', False)]
    if not unresolved:
        sys.exit(0)
    print(f'## {len(unresolved)} unresolved follow-up(s) from previous sessions\n')
    for f in unresolved:
        urgency = f.get('urgency', 'medium')
        marker = '!!' if urgency == 'high' else '--'
        print(f'  {marker} [{f[\"type\"]}] {f[\"content\"][:200]}')
        print(f'     (created: {f[\"created_at\"][:10]}, id: {f[\"id\"]})')
        print()
except Exception as e:
    pass
" 2>/dev/null)

if [ -n "$UNRESOLVED" ]; then
  echo "$UNRESOLVED"
fi
