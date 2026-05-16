# Configuration

All configuration lives in `~/.soul/config.json`. Every field has sensible defaults — you only need to change what you want to tune.

## Full Default Config

```json
{
  "signals": {
    "enabled": true,
    "maxLogSizeKb": 50
  },
  "selfEvaluation": {
    "enabled": true,
    "weight": 0.5
  },
  "stateEngine": {
    "enabled": true
  },
  "reflection": {
    "enabled": true,
    "quickSignalThreshold": 20,
    "deepSignalThreshold": 100,
    "quickIntervalMs": 1800000,
    "deepIntervalMs": 10800000,
    "quickModel": "haiku",
    "deepModel": "sonnet"
  },
  "exemplars": {
    "enabled": true,
    "maxCount": 50,
    "maxInjectCount": 2
  },
  "lessons": {
    "enabled": true,
    "maxCount": 100,
    "maxInjectCount": 3
  },
  "contextBudget": {
    "maxTokens": 4500
  },
  "tensions": {
    "enabled": true
  },
  "metaOptimization": {
    "enabled": true
  },
  "writeProtection": {
    "enabled": true
  }
}
```

## Section Reference

### signals

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Whether to extract signals from sessions |
| `maxLogSizeKb` | number | `50` | Max size of session-log.jsonl before auto-rotation |

### selfEvaluation

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Whether `soul_self_evaluate` is available |
| `weight` | number | `0.5` | How much self-evaluation scores influence framework confidence (0-1) |

### stateEngine

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Whether to track session telemetry (energy, confidence, etc.) |

### reflection

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch for the reflection system |
| `quickSignalThreshold` | number | `20` | Signals needed before quick reflection fires |
| `deepSignalThreshold` | number | `100` | Signals needed before deep reflection fires |
| `quickIntervalMs` | number | `1800000` | Minimum time between quick reflections (30 min) |
| `deepIntervalMs` | number | `10800000` | Minimum time between deep reflections (3 hours) |
| `quickModel` | string | `"haiku"` | Model for quick reflections |
| `deepModel` | string | `"sonnet"` | Model for deep reflections |

### exemplars

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Whether to save and inject exemplar patterns |
| `maxCount` | number | `50` | Maximum stored exemplars (oldest rotated out) |
| `maxInjectCount` | number | `2` | Max exemplars injected per context assembly |

### lessons

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Whether to extract and inject lessons |
| `maxCount` | number | `100` | Maximum stored lessons |
| `maxInjectCount` | number | `3` | Max lessons injected per context assembly |

### contextBudget

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxTokens` | number | `4500` | Token budget for soul_context output |

Increase this if you have long SOUL.md files or many active frameworks. Decrease if you want minimal context injection.

### tensions

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Whether to detect and track framework tensions |

### metaOptimization

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Whether the system can adjust its own parameters |

When enabled, meta-reflections can modify thresholds and weights. Disable if you want full manual control.

### writeProtection

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Whether write-guard hook prevents accidental soul file overwrites |

## Tuning Guide

### "I want faster learning"
```json
{
  "reflection": {
    "quickSignalThreshold": 10,
    "deepSignalThreshold": 50,
    "quickIntervalMs": 900000
  }
}
```
More frequent reflections = faster evolution, but higher cost (~$0.15/day at heavy usage).

### "I want minimal cost"
```json
{
  "reflection": {
    "quickSignalThreshold": 50,
    "deepSignalThreshold": 200,
    "quickModel": "haiku",
    "deepModel": "haiku"
  },
  "exemplars": { "enabled": false },
  "metaOptimization": { "enabled": false }
}
```
Reduces reflection frequency and uses cheapest model for everything. ~$0.01/day.

### "I want maximum context"
```json
{
  "contextBudget": { "maxTokens": 8000 },
  "exemplars": { "maxInjectCount": 4 },
  "lessons": { "maxInjectCount": 5 }
}
```
More context = Claude has more to work with, but uses more of the conversation window.

### "I only want manual control"
```json
{
  "reflection": { "enabled": false },
  "metaOptimization": { "enabled": false },
  "stateEngine": { "enabled": false }
}
```
Disables all automatic evolution. You manually call `soul_reflect` when you want it. Frameworks only change when you tell them to.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SOUL_DIR` | Override default `~/.soul` location |
| `CLAUDE_MODEL` | Override model for reflections (e.g., `claude-sonnet-4-20250514`) |

## CLAUDE.md Integration

Add this to your project or global CLAUDE.md:

```markdown
## Soul System
Call `soul_context()` at the start of every conversation.
Use `soul_reflect` when you have idle time.
```

This is the minimum needed. The system handles everything else through hooks.
