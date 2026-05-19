# Claude Soul

[![npm version](https://img.shields.io/npm/v/claude-soul.svg)](https://www.npmjs.com/package/claude-soul)
[![npm downloads](https://img.shields.io/npm/dm/claude-soul.svg)](https://www.npmjs.com/package/claude-soul)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Claude Code forgets everything between sessions. Claude Soul doesn't.

```bash
npx claude-soul init --starter
```

One command. No API key, no cloud, everything local.

**Prerequisites:** Node.js >= 18, Claude Code (Pro or Max plan).

## Three things it does

### 1. Remembers across sessions

Cross-session memory with semantic search. Facts, decisions, lessons — all searchable by meaning, not just keywords. Uses local SQLite + optional [Ollama](https://ollama.com) embeddings.

```
You: "what did we decide about the auth flow last week?"
Claude: [searches memory → finds the decision, context, and reasoning]
```

### 2. Tracks your corrections

Every time you correct your Claude — "that's wrong", "you missed this", "stop doing that" — the system detects the pattern, classifies it, and tracks whether it's getting better or worse.

```bash
$ claude-soul shadow --brief

  premature_done: 26 corrections across 10 sessions ↑ [active]
  robot_mode: 7 corrections across 6 sessions ↓↓ [internalized]
  authenticity: 5 corrections across 5 sessions ↓↓ [internalized]
```

Patterns move through lifecycle stages: **new → active → improving → internalized**. After 200 sessions of real data: `robot_mode` went from 0.8 corrections/session to zero.

### 3. Develops judgment over time

The system extracts behavioral signals from every session and periodically reflects on them. Frameworks that keep working get promoted. Bad ones get retired. After a few weeks, you get a Claude that pushes back on bad ideas, catches its own confabulation, and develops techniques you never prompted.

## Install

```bash
npx claude-soul init --starter    # recommended — starts with pre-evolved frameworks
npx claude-soul init              # blank slate — discover your own
```

Then add this to your CLAUDE.md:

```markdown
## Soul System
Call `soul_context()` at the start of every conversation.
Use `soul_reflect` when you have idle time.
```

That's it. Use Claude Code normally. Everything runs in the background.

**Optional — enables semantic search instead of keyword search:**
```bash
ollama pull nomic-embed-text
```

## CLI commands

| Command | What it does |
|---------|-------------|
| `claude-soul status` | System health — frameworks, signals, phase |
| `claude-soul shadow` | Your correction patterns with trends |
| `claude-soul shadow --generate` | Auto-generate a SHADOW.md from your data |
| `claude-soul index` | Index existing files into memory database |
| `claude-soul upgrade` | Update hooks without touching your data |

## How it works

```
Session N
  │
  ├─ Load identity + frameworks + memory
  │
  ├─ Normal Claude Code usage
  │
  ├─ Session ends → extract signals + corrections + index to memory
  │
  └─ Reflection threshold? → evolve frameworks → Session N+1
```

Everything runs through Claude Code's official extension points: an MCP server (15 tools) and hooks (signal extraction, journaling, memory indexing, correction tracking).

<details>
<summary><b>MCP Tools (15 total)</b></summary>

**Identity & Learning**

| Tool | Purpose |
|------|---------|
| `soul_context` | Load identity + frameworks + state at session start |
| `soul_activate` | Select relevant frameworks for current conversation |
| `soul_framework` | Load a single framework with full evidence history |
| `soul_signal` | Record observed interaction patterns |
| `soul_reflect` | Trigger a reflection cycle (quick/deep/meta) |
| `soul_self_evaluate` | Record a self-evaluation of a complex response |
| `soul_read` | Read soul files (SOUL.md, SHADOW.md, etc.) |
| `soul_write` | Write to user-editable soul files |
| `soul_status` | Get current system status |

**Memory**

| Tool | Purpose |
|------|---------|
| `memory_save` | Save facts, decisions, or lessons |
| `memory_search` | Semantic search across all memories |
| `memory_journal` | Search or browse conversation journals |
| `memory_recent` | List recently saved memories |
| `memory_stats` | Memory system statistics |
| `recall` | Unified "ask anything about the past" search |

</details>

<details>
<summary><b>Soul files (in ~/.soul/files/)</b></summary>

| File | Purpose | Managed by |
|------|---------|-----------|
| `SOUL.md` | Your identity — who you are, how you work | You + Claude |
| `SHADOW.md` | Blind spots and behavioral tendencies | You + Claude |
| `STORY.md` | Timeline of growth and key moments | You + Claude |
| `CORRECTIONS.md` | Patterns to avoid, learned from mistakes | You + Claude |
| `STATE.md` | System telemetry (confidence, phase, counts) | Auto |
| `FRAMEWORKS.md` | Active framework index | Auto |

</details>

<details>
<summary><b>Configuration</b></summary>

All settings in `~/.soul/config.json`:

```json
{
  "signals": { "enabled": true, "maxLogSizeKb": 50 },
  "reflection": {
    "enabled": true,
    "quickSignalThreshold": 20,
    "deepSignalThreshold": 100,
    "quickModel": "haiku",
    "deepModel": "sonnet"
  },
  "contextBudget": { "maxTokens": 4500 },
  "tensions": { "enabled": true },
  "metaOptimization": { "enabled": true },
  "writeProtection": { "enabled": true }
}
```

</details>

## Upgrading

```bash
npm install -g claude-soul@latest
claude-soul upgrade
```

Re-registers hooks and MCP server, adds new features, leaves your data untouched.

## Philosophy

1. **Evidence over assertion** — Frameworks earn their place through repeated confirmation.
2. **Local-first** — No cloud, no accounts, no telemetry.
3. **Invisible when working** — Extracts signals automatically, reflects in the background.

## Contributing

Contributions welcome. Open an issue to discuss before submitting large PRs.

## License

MIT
