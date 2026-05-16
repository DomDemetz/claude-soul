# Claude Soul

> Claude Code forgets everything between sessions. Claude Soul doesn't.

A self-improving learning engine that gives Claude Code persistent identity, cross-session memory, and evolving cognitive frameworks. Not a static prompt — a living system that develops over time.

## Not memory. Growth.

Memory plugins store what happened. Claude Soul develops *how to think*.

| Without Claude Soul | With Claude Soul |
|---|---|
| Every session starts from zero | Sessions build on all previous ones |
| Makes the same mistakes repeatedly | Learns from corrections permanently |
| Generic responses regardless of user | Adapts to your thinking style over time |
| No awareness of what worked | Tracks successes, failures, and patterns |
| Static system prompt | Evolving cognitive frameworks with evidence tiers |

## What actually changes

**From day one** (with `--starter`):
- Pushback, strategic thinking, and verification behaviors are seeded into the identity file
- 6 active frameworks guide responses immediately (depth calibration, confabulation detection, etc.)
- Signal extraction begins — every correction, success, or confusion is captured

**After ~1 week** (~20 sessions):
- First reflection fires — frameworks gain or lose confidence based on YOUR usage
- Frameworks that don't apply to your work get retired automatically
- New frameworks emerge from patterns specific to you

**After ~2 months** (~200 sessions):
- **Pushback.** Claude stops being a yes-machine. It disagrees when you're about to make a mistake, suggests alternatives unprompted, and treats your project like its own.
- **Depth calibration.** Asks that need one line get one line. Complex architecture questions get depth. It learns your signal for "too much" vs "not enough."
- **Self-correction.** Catches its own confabulation mid-response, verifies before stating facts about APIs or code it hasn't read, flags uncertainty instead of guessing confidently.
- **Strategic thinking.** Suggests timing, positioning, tradeoffs — not just executes tasks. Thinks across sessions about what matters.
- **Pattern memory without memorizing.** Doesn't store "user likes X" as a static fact. Develops frameworks like "verify before stating" that adapt based on evidence — confirmed when it works, weakened when it doesn't.

The system watches what works, reflects on patterns, and evolves its own cognitive frameworks through evidence. The frameworks that survive are the ones that actually helped.

## Quick start

```bash
npx claude-soul init --starter
```

That's it. The wizard creates `~/.soul/`, writes your identity files, registers the MCP server, and installs hooks. The `--starter` flag includes pre-evolved frameworks so you see the system working from session one (omit it for a blank slate).

Then add this to your CLAUDE.md:

**Prerequisites:** Node.js >= 18, Claude Code with a Max plan (for MCP support).

### Install from source

If you prefer building from source or want the latest (including `--starter`):

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

Then use Claude Code normally. The system works in the background:

1. **Signals** — automatically extracts learning signals from every conversation (corrections, confusion, success patterns)
2. **Reflection** — periodically synthesizes signals into cognitive frameworks using an LLM
3. **Evolution** — frameworks gain or lose confidence based on real evidence
4. **Context** — each session loads the most relevant frameworks automatically

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│                        SESSION N                                  │
│                                                                   │
│  soul_context() ──→ Load identity + frameworks + signals + state │
│       │                                                           │
│       ▼                                                           │
│  Normal Claude Code usage (coding, debugging, discussing)        │
│       │                                                           │
│       ▼                                                           │
│  Stop hook ──→ Extract signals from conversation                 │
│       │         (correction, gratitude, confusion, success...)    │
│       │                                                           │
│       ▼                                                           │
│  Signal store accumulates                                         │
│       │                                                           │
│       ▼ (threshold reached)                                       │
│  Reflection ──→ Test frameworks against signals                  │
│       │         Discover new frameworks                           │
│       │         Retire contradicted ones                          │
│       │         Detect tensions between frameworks                │
│       │                                                           │
│       ▼                                                           │
│  Updated framework store ──→ Available for SESSION N+1           │
└─────────────────────────────────────────────────────────────────┘
```

## The learning engine

The core differentiator. Frameworks are not static rules — they're living hypotheses that evolve through use.

### Evidence tiers

```
hypothesis  ──→  observed  ──→  validated
(untested)      (1+ external     (3+ external
                 confirmation)    confirmations)
```

Frameworks advance through evidence. They can also be retired when contradicted, or merged when redundant.

### Phase-adaptive learning

The system adjusts its learning cadence based on maturity:

- **Apprentice** — Tight feedback loops. Quick reflections after 5 signals. Cast a wide net.
- **Creative** — Moderate cadence. Refine and merge. Build the latticework.
- **Mastery** — Deliberate reflection. Fewer, more powerful frameworks. Meta-optimize.

### Three reflection tiers

| Tier | Trigger | Model | What it does |
|------|---------|-------|-------------|
| Quick | 5-20 signals | Haiku | Tests existing frameworks against recent signals |
| Deep | 25-100 signals | Sonnet | Full analysis, discovers new frameworks, generates lessons |
| Meta | Manual or auto | Sonnet | Audits framework coherence, detects redundancy, calibrates confidence |

## Architecture

Built entirely on Claude Code's official extension points:

- **MCP Server** — 9 tools for identity, learning, and reflection
- **Hooks** — automatic signal extraction, journaling, follow-up tracking
- **No cloud services** — everything runs locally, your data stays on your machine
- **Single runtime dependency** — `@modelcontextprotocol/sdk`
- **Reflections use your existing Claude subscription** — no separate API key needed

### MCP Tools

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

### Soul files

| File | Purpose | Managed by |
|------|---------|-----------|
| `SOUL.md` | Your identity — who you are, how you work | You + Claude |
| `SHADOW.md` | Blind spots and behavioral tendencies | You + Claude |
| `STORY.md` | Timeline of growth and key moments | You + Claude |
| `CORRECTIONS.md` | Patterns to avoid, learned from mistakes | You + Claude |
| `STATE.md` | System telemetry (confidence, phase, counts) | Auto |
| `FRAMEWORKS.md` | Active framework index | Auto |

### Data files

| File | Purpose |
|------|---------|
| `frameworks.json` | Full framework store with evidence, confidence, tiers |
| `session-log.jsonl` | Append-only signal log (auto-truncates at 50KB) |
| `lessons.json` | Extracted principles with confidence scores |
| `exemplars.json` | Best-practice response examples |
| `tensions.json` | Detected contradictions between frameworks |
| `meta.json` | Phase state, reflection count, survival rate |

## What you get after 1 week

After ~20 conversations, your system will have:

- Discovered 3-5 new frameworks specific to your work style
- Promoted seed frameworks from hypothesis to observed based on real usage
- Retired frameworks that don't apply to you
- Built a lesson store of concrete, applicable insights
- Detected tensions between competing approaches
- A daily journal of all sessions (searchable)

## Hooks

Claude Soul uses Claude Code hooks for automatic signal extraction:

### Stop hook (runs when session ends)
Extracts signals from the conversation transcript. Detects corrections, confusion, gratitude, topic shifts, and success patterns. Triggers reflection if signal threshold is reached.

### Session journal (optional)
Appends a summary of each session to `~/.soul/journals/YYYY-MM-DD.md`.

### Follow-up tracking (optional)
Detects deferred threads and unresolved questions. Surfaces them at the next session start.

### Write guard
Prevents accidental edits to auto-managed files (STATE.md, FRAMEWORKS.md).

## Configuration

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

## Cost

Reflections run via `claude -p` (Claude Code's programmatic mode) — they use your existing Claude Code subscription. No separate API key or billing needed. A typical week adds ~20 short reflection calls, which is negligible within a Max plan's usage.

## Philosophy

Three principles:

1. **Evidence over assertion** — Frameworks earn their place through repeated confirmation. Hypotheses that aren't confirmed get retired, not preserved.
2. **Local-first** — No cloud, no accounts, no telemetry. Your cognitive development stays on your machine.
3. **Invisible when working** — The system shouldn't require attention. It extracts signals automatically, reflects in the background, and surfaces relevant context without being asked.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
