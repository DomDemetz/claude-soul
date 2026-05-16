# Agent Self-Install Guide

Instructions for a Claude Code agent to install Claude Soul on a machine. Copy this into a prompt or CLAUDE.md and the agent will handle the rest.

---

## Prompt for Agent

```markdown
Install the Claude Soul learning engine on this machine. Follow these steps exactly:

### 1. Prerequisites check
- Verify Node.js >= 18 is installed: `node --version`
- Verify Claude CLI is installed: `claude --version`
- If either is missing, stop and report what needs to be installed first.

### 2. Install
Run:
```bash
npx claude-soul init
```

This will:
- Create ~/.soul/ directory structure
- Write identity files (SOUL.md, SHADOW.md, STORY.md, CORRECTIONS.md)
- Write config.json with default settings
- Register the MCP server with Claude Code
- Install session hooks

If prompted for identity setup, either answer the questions or press Enter to skip.

### 3. Verify installation
Run these checks:
```bash
# Verify directory structure
ls ~/.soul/files/
# Expected: CORRECTIONS.md  SHADOW.md  SOUL.md  STORY.md

# Verify config
cat ~/.soul/config.json | head -5
# Expected: JSON with "signals", "reflection", etc.

# Verify hooks installed
ls ~/.soul/hooks/
# Expected: check-follow-ups.sh  session-agency.js  session-journal.sh  session-scratchpad.sh  write-guard.sh

# Verify MCP server registered
claude mcp list | grep claude-soul
# Expected: claude-soul entry with node command
```

### 4. Activate in CLAUDE.md
Add this to the user's CLAUDE.md (global or project-level):

```markdown
## Soul System
Call `soul_context()` at the start of every conversation.
Use `soul_reflect` when you have idle time.
```

### 5. Test the MCP server
In a new Claude Code session, call `soul_context` and verify it returns framework context. If it errors, check:
- Is the server path correct in `claude mcp list`?
- Does `~/.soul/config.json` exist?
- Can Node.js run the server? Try: `npx claude-soul-server` (should hang waiting for stdin — that's correct, Ctrl+C to exit)

### 6. Post-install (optional)
Edit `~/.soul/files/SOUL.md` to personalize the identity. This file is loaded at the start of every session. Good things to add:
- What should Claude call the user
- What kind of work they do
- Communication preferences (concise? detailed? technical?)

---

## Troubleshooting

**"claude: command not found"**
Claude Code CLI isn't installed or isn't in PATH. Install from https://claude.ai/code

**"MCP server not registered"**
Run manually:
```bash
claude mcp add --scope user claude-soul -- npx claude-soul-server
```

**"soul_context returns error"**
Check if ~/.soul/config.json exists. If not, run `npx claude-soul init` again.

**"Hooks not firing"**
Hooks require Claude Code's hook system. Verify with:
```bash
cat ~/.claude/settings.json | grep -A5 hooks
```
If no hooks section exists, the init command may not have had permission to modify settings. Add hooks manually — see the main README for the hook configuration format.
```

---

## One-liner for automated install

For CI/CD or automated setups where no interactive prompts are desired:

```bash
npx claude-soul init --skip-identity && echo '## Soul System\nCall `soul_context()` at the start of every conversation.' >> ~/.claude/CLAUDE.md
```
