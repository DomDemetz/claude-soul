# After One Week

What to expect as Claude Soul learns from your interactions.

## Day 1-2: Signal Accumulation

The system is observing. Signals are being extracted from every session — corrections, gratitude, confusion patterns, topic shifts. Nothing visible changes yet.

**What you'll notice:** Nothing different. That's intentional.

**What's happening underneath:**
- `session-log.jsonl` is filling with signals
- State engine is calibrating baseline energy/confidence
- Your SOUL.md is the only identity context being loaded

**Check:** Run `claude-soul status` — you should see signals accumulating.

## Day 2-3: First Quick Reflection

After ~20 signals accumulate (typically 3-5 sessions), the first quick reflection fires. A Haiku model reads your signal patterns and makes initial observations.

**What you'll notice:** Subtle. The context loaded at session start now includes 1-2 observations. Responses may feel slightly more calibrated.

**What's happening:**
- Framework confidence scores begin moving (±0.05 typical)
- First lessons extracted from signal patterns
- State engine has enough data for meaningful telemetry

**Check:** Look at `~/.soul/reflections/` — you'll see timestamped reflection outputs.

## Day 3-5: Framework Activation

With enough evidence, the first seed frameworks move from `questioning` to `active`. These are the ones that match your actual usage patterns.

**What you'll notice:** Claude remembers behavioral patterns across sessions. If you consistently prefer concise answers, the "Depth Calibration" framework activates and influences responses. If you catch confabulation early, that framework strengthens.

**What's happening:**
- Evidence tiers advancing: hypothesis → observed
- Frameworks that don't match your patterns stay at low confidence
- First tensions may be detected between competing frameworks

**Check:** Run `soul_status` in Claude Code — it shows active vs. questioning counts.

## Day 5-7: Deep Reflection & Evolution

After ~100 signals, the first deep reflection fires (Sonnet model). This is where real evolution happens.

**What you'll notice:** Frameworks may merge, new ones may be discovered from your interaction patterns, and the system starts feeling personalized rather than generic.

**What's happening:**
- Deep reflection analyzes the full signal corpus
- May discover new frameworks specific to your workflow
- May retire seed frameworks that never gained evidence
- Lessons become more specific and actionable
- Exemplars (high-quality response patterns) start being saved

**Check:** Compare `frameworks.json` to the initial state — you'll see version numbers incremented, some frameworks with `status: "active"`, others still `"questioning"`.

## After Two Weeks

The system reaches its stride:

- **Framework survival rate** stabilizes (typically 40-60% of seeds survive)
- **Evidence tiers** show validated frameworks (3+ external confirmations)
- **Tensions** between frameworks are tracked and surfaced when relevant
- **Meta-optimization** starts adjusting its own parameters (if enabled)
- **Journal** provides a searchable history of what happened in each session

## What "Better" Actually Looks Like

Claude Soul doesn't make Claude smarter in general. It makes Claude smarter *for you specifically*. Concrete examples of what changes:

- **Before:** Claude gives a detailed 500-word explanation when you just needed the command.
- **After:** "Depth Calibration" framework learned you prefer concise answers. Gives the command first, explanation on request.

- **Before:** Claude guesses at implementation details it's unsure about.
- **After:** "Confabulation Detection" framework triggers. Claude explicitly flags uncertainty instead of confabulating.

- **Before:** Every session starts from zero behavioral context.
- **After:** Corrections from 3 weeks ago still influence today's responses (if the underlying pattern persists in the evidence).

## Troubleshooting

**"Nothing seems to be changing"**
1. Check `claude-soul status` — are signals accumulating?
2. Check `~/.soul/reflections/` — are reflections firing?
3. Make sure `soul_context()` is being called at session start (add it to CLAUDE.md)

**"Frameworks aren't activating"**
- Normal for the first few days. Activation requires evidence tier ≥ observed (at least 1 external confirmation) AND confidence ≥ 0.5.
- Use `soul_self_evaluate` after complex responses to generate evidence faster.

**"It learned something wrong"**
- Edit `CORRECTIONS.md` directly — this is always loaded at highest priority.
- Or call `soul_framework` to manually adjust confidence or retire a framework.
- The system respects manual overrides and treats them as strong evidence.

**"Too much context is being loaded"**
- Reduce `contextBudget.maxTokens` in config.json (default: 4500)
- Or reduce `lessons.maxInjectCount` and `exemplars.maxInjectCount`

## Metrics to Watch

After one week, run `claude-soul status` and look for:

| Metric | Healthy Range | Concern If |
|--------|--------------|-----------|
| Active frameworks | 4-8 | 0 (nothing activated) or 12 (no discrimination) |
| Framework survival rate | 40-70% | < 20% (too aggressive) or 100% (not learning) |
| Signals pending | 0-20 | > 100 (reflections not firing) |
| Unresolved follow-ups | 0-5 | > 10 (system overwhelmed) |
| Journal entries | 5-7 | 0 (hooks not running) |
