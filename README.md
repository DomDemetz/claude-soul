# Claude Soul

[![npm version](https://img.shields.io/npm/v/claude-soul.svg)](https://www.npmjs.com/package/claude-soul)
[![npm downloads](https://img.shields.io/npm/dm/claude-soul.svg)](https://www.npmjs.com/package/claude-soul)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Claude Code forgets everything between sessions. Claude Soul doesn't.

A self-improving learning engine that gives Claude Code persistent identity, cross-session memory, and evolving cognitive frameworks. Not a static prompt — a system that develops over time.

```bash
npx claude-soul init --starter
```

That's it. One command. No API key, no cloud, everything local.

**Prerequisites:** Node.js >= 18, Claude Code (Pro or Max plan).

<!-- TODO: add demo.gif here -->

## What happens

Every session, the system silently extracts signals — corrections you make, things that work, confusion patterns. After ~20 sessions, it reflects on those signals and builds behavioral frameworks. Frameworks that keep working get promoted. Bad ones get retired.

After ~200 sessions, you get a Claude that pushes back on bad ideas, calibrates response depth to what you actually need, catches its own confabulation, and develops techniques you never prompted.

The difference from memory plugins: this doesn't store "user likes X." It develops judgment.

## Quick example

```
You: "load soul context"
Claude: [loads identity + 6 active frameworks + state from previous sessions]

You: "run a quick reflection"  
Claude: [analyzes 23 signals → promotes 2 frameworks, retires 1, discovers new pattern]

You: "what frameworks are active?"
Claude: [shows evolved frameworks with confidence scores and evidence tiers]
```

## How it works

```
Session N
  │
  ├─ soul_context() → load identity + frameworks + state
  │
  ├─ Normal Claude Code usage
  │
  ├─ Stop hook → extract signals (corrections, success, confusion)
  │
  ├─ Signal threshold reached?
  │     └─ Yes → Reflection → test/discover/retire frameworks
  │
  └─ Updated frameworks available for Session N+1
```

Frameworks evolve through evidence tiers:

```
hypothesis → observed → validated
(untested)   (1+ confirmation)   (3+ confirmations)
```

## What actually changes over time

**Day one** (with `--starter`): 6 active frameworks, signal extraction begins, pushback and verification behaviors seeded.

**~1 week** (~20 sessions): First reflection fires. Frameworks gain or lose confidence based on YOUR usage. New ones emerge from your patterns.

**~2 months** (~200 sessions): Pushback on bad ideas. Depth calibration. Self-correction. Strategic thinking. Pattern memory that adapts based on evidence, not static preferences.

## Install options

With starter frameworks (recommended):
```bash
npx claude-soul init --starter
```

Blank slate (discover your own from scratch):
```bash
npx claude-soul init
```

From source:
```bash
git clone https://github.com/DomDemetz/claude-soul.git
cd claude-soul && npm install && npm run build
node packages/cli/dist/index.js init --starter
```

### After install

Add this to your CLAUDE.md (global or project-level):

```markdown
## Soul System
Call `soul_context()` at the start of every conversation.
Use `soul_reflect` when you have idle time.
```

Then use Claude Code normally. The system works in the background.

## Things you can say

| What you want | What to say |
|---|---|
| Load context | "load soul context" |
| Quick reflection | "reflect on recent sessions" |
| Deep reflection | "do a deep reflection" |
| Meta audit | "run a meta reflection" |
| System health | "what's your soul status?" |
| Record a signal | "signal: that approach worked well because..." |
| See frameworks | "what frameworks are active?" |

## Architecture

Built entirely on Claude Code's official extension points:

- **MCP Server** — 9 tools for identity, learning, and reflection
- **Hooks** — automatic signal extraction, journaling, follow-up tracking
- **Local-only** — everything on your machine, no cloud, no telemetry
- **Single dependency** — `@modelcontextprotocol/sdk`
- **Uses your existing subscription** — no separate API key needed

### Three reflection tiers

| Tier | Trigger | What it does |
|------|---------|-------------|
| Quick | ~20 signals | Tests existing frameworks against recent signals |
| Deep | 25-100 signals | Full analysis, discovers new frameworks, generates lessons |
| Meta | Manual or auto | Audits framework coherence, detects redundancy |

### Phase-adaptive learning

The system adjusts based on maturity:
- **Apprentice** — Tight feedback loops. Quick reflections. Cast a wide net.
- **Creative** — Moderate cadence. Refine and merge.
- **Mastery** — Deliberate reflection. Fewer, more powerful frameworks.

<details>
<summary><b>MCP Tools (9 total)</b></summary>

| Tool | Purpose |
|------|---------|
| `soul_context` | Load identity + frameworks + state at session start |
| `soul_activate` | Select relevant frameworks for the current conversation |
| `soul_framework` | Load a single framework with full evidence history |
| `soul_signal` | Manually record observed interaction patterns |
| `soul_reflect` | Trigger a reflection cycle (quick/deep/meta) |
| `soul_self_evaluate` | Record a self-evaluation of a complex response |
| `soul_read` | Read soul files (SOUL.md, SHADOW.md, etc.) |
| `soul_write` | Write to user-editable soul files |
| `soul_status` | Get current system status |

</details>

<details>
<summary><b>Soul files</b></summary>

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
<summary><b>Data files</b></summary>

| File | Purpose |
|------|---------|
| `frameworks.json` | Full framework store with evidence, confidence, tiers |
| `session-log.jsonl` | Append-only signal log (auto-truncates at 50KB) |
| `lessons.json` | Extracted principles with confidence scores |
| `exemplars.json` | Best-practice response examples |
| `tensions.json` | Detected contradictions between frameworks |
| `meta.json` | Phase state, reflection count, survival rate |

</details>

<details>
<summary><b>Hooks</b></summary>

- **Stop hook** — Extracts signals from conversation transcript at session end. Triggers reflection if threshold reached.
- **Session journal** — Appends session summary to `~/.soul/journals/YYYY-MM-DD.md`.
- **Follow-up tracking** — Detects deferred threads, surfaces them next session.
- **Write guard** — Prevents accidental edits to auto-managed files.

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

## Philosophy

1. **Evidence over assertion** — Frameworks earn their place through repeated confirmation. Hypotheses that aren't confirmed get retired.
2. **Local-first** — No cloud, no accounts, no telemetry. Your cognitive development stays on your machine.
3. **Invisible when working** — Extracts signals automatically, reflects in the background, surfaces context without being asked.

## Contributing

Contributions welcome. Open an issue to discuss before submitting large PRs.

## License

MIT
