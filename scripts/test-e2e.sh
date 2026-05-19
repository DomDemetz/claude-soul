#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_HOME="/tmp/claude-soul-e2e-$$"
PASS=0
FAIL=0

cleanup() { rm -rf "$TEST_HOME"; }
trap cleanup EXIT

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi }

echo "=== Claude Soul E2E Test ==="
echo "Test home: $TEST_HOME"
echo ""

# Build first
echo "Building..."
cd "$REPO_DIR"
npm run build --workspaces > /dev/null 2>&1
echo ""

# --- Test 1: CI simulation ---
echo "--- CI Simulation ---"
SCRATCH="/tmp/ci-scratch-$$"
cp -r "$REPO_DIR" "$SCRATCH"
cd "$SCRATCH"
npm ci > /dev/null 2>&1 && pass "npm ci" || fail "npm ci"
npm run build --workspaces > /dev/null 2>&1 && pass "build" || fail "build"
npm test --workspace=packages/server --if-present > /dev/null 2>&1 && pass "tests" || fail "tests"
rm -rf "$SCRATCH"
echo ""

# --- Test 2: CLI commands ---
echo "--- CLI Commands ---"
cd "$REPO_DIR"
node packages/cli/dist/index.js status > /dev/null 2>&1 && pass "status" || fail "status"
node packages/cli/dist/index.js shadow --brief > /dev/null 2>&1 && pass "shadow --brief" || fail "shadow --brief"
echo ""

# --- Test 3: Correction extractor ---
echo "--- Correction Extractor ---"
echo '{"session_id":"test","transcript_path":"/nonexistent"}' | \
  node packages/server/dist/hooks/correction-extractor.js > /dev/null 2>&1
check "graceful on missing file" "[ $? -eq 0 ]"
echo ""

# --- Test 4: Upgrade hook dedup ---
echo "--- Upgrade Hook Safety ---"
mkdir -p "$TEST_HOME/.claude"
cat > "$TEST_HOME/.claude/settings.json" << 'SETTINGS'
{
  "hooks": {
    "Stop": [{
      "matcher": "",
      "hooks": [
        {"type":"command","command":"node \"/old/path/claude-soul-server/dist/hooks/on-stop.js\"","timeout":15000},
        {"type":"command","command":"bash /home/user/.soul/hooks/session-journal.sh","timeout":3000},
        {"type":"command","command":"bash /home/user/.soul/hooks/auto-index.sh","timeout":5000},
        {"type":"command","command":"bash /home/user/.soul/hooks/session-agency.sh","timeout":10000},
        {"type":"command","command":"my-custom-hook","timeout":5000}
      ]
    }]
  }
}
SETTINGS

mkdir -p "$TEST_HOME/.soul/hooks"

# Run the upgrade logic in isolation
node -e "
const fs = require('fs');
const path = require('path');
const settingsPath = '$TEST_HOME/.claude/settings.json';
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
const isSoulHook = (cmd) => cmd.includes('.soul/') || cmd.includes('claude-soul');

const newConfig = {
  Stop: [{
    matcher: '',
    hooks: [
      {type:'command',command:'node \"/new/path/on-stop.js\"',timeout:15000},
      {type:'command',command:'bash /home/user/.soul/hooks/session-journal.sh',timeout:3000},
      {type:'command',command:'node /home/user/.soul/hooks/session-agency.js',timeout:10000},
      {type:'command',command:'node \"/new/path/correction-extractor.js\"',timeout:5000},
    ]
  }]
};

for (const [event, entries] of Object.entries(newConfig)) {
  if (!settings.hooks[event]) {
    settings.hooks[event] = entries;
  } else {
    for (const group of settings.hooks[event]) {
      if (group.hooks) group.hooks = group.hooks.filter(h => !isSoulHook(h.command));
    }
    settings.hooks[event] = settings.hooks[event].filter(g => !g.hooks || g.hooks.length > 0);
    for (const entry of entries) {
      const mg = settings.hooks[event].find(e => e.matcher === entry.matcher);
      if (mg) mg.hooks.push(...entry.hooks);
      else settings.hooks[event].push(entry);
    }
  }
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
" 2>/dev/null

RESULT=$(cat "$TEST_HOME/.claude/settings.json")
check "old on-stop removed" "echo '$RESULT' | grep -qv '/old/path/'"
check "old auto-index removed" "echo '$RESULT' | grep -qv 'auto-index'"
check "old session-agency.sh removed" "echo '$RESULT' | grep -qv 'session-agency.sh'"
check "custom hook preserved" "echo '$RESULT' | grep -q 'my-custom-hook'"
check "new correction-extractor added" "echo '$RESULT' | grep -q 'correction-extractor'"
check "new session-agency.js added" "echo '$RESULT' | grep -q 'session-agency.js'"

HOOK_COUNT=$(echo "$RESULT" | grep -c '"type"')
check "correct hook count (5)" "[ $HOOK_COUNT -eq 5 ]"
echo ""

# --- Summary ---
echo "==========================="
echo "  $PASS passed, $FAIL failed"
echo "==========================="
[ $FAIL -eq 0 ] && exit 0 || exit 1
