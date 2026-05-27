import type { InternalState } from "../types/learning-types.js";
import type { FrameworkStore } from "../types/learning-types.js";
import {
  STATE_PATH,
  META_PATH,
  FRAMEWORKS_PATH,
  SESSION_LOG_PATH,
  DATA_DIR,
  soulFilePath,
} from "../util/files.js";
import { readJsonSafe, writeJsonAtomic } from "../util/files.js";
import fs from "node:fs/promises";
import path from "node:path";

export type StateEvent =
  | { type: "session_start" }
  | { type: "time_elapsed"; hoursActive: number }
  | { type: "positive_interaction"; delta: number }
  | { type: "negative_interaction"; delta: number }
  | { type: "correction" }
  | { type: "tool_failure" }
  | { type: "successful_task"; complexity: "simple" | "complex" }
  | { type: "novel_topic" }
  | { type: "idle"; hours: number };

const DEFAULTS: InternalState = {
  energy: 1.0,
  mood: 0.6,
  confidence: 0.6,
  socialCharge: 0.5,
  curiosity: 0.5,
  frustration: 0.0,
  hoursActive: 0,
  lastSuccessMinAgo: -1,
  lastFailureMinAgo: -1,
  lastTickAt: Date.now(),
};

const MOOD_BASELINE = 0.6;
const MOOD_REGRESSION_RATE = 0.02;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function trendWord(value: number, baseline: number): string {
  const diff = value - baseline;
  if (diff > 0.05) return "rising";
  if (diff < -0.05) return "falling";
  return "steady";
}

type MetaState = {
  phase?: string;
  reflectionCount?: number;
  totalDiscovered?: number;
  totalRetired?: number;
  lastPhaseTransition?: number;
};

type FollowUp = {
  status?: string;
  summary?: string;
  created?: string;
};

export class StateEngine {
  private state: InternalState;

  constructor() {
    this.state = { ...DEFAULTS };
  }

  async load(): Promise<void> {
    this.state = await readJsonSafe<InternalState>(STATE_PATH, { ...DEFAULTS });
  }

  async save(): Promise<void> {
    await writeJsonAtomic(STATE_PATH, this.state);
  }

  recordEvent(event: StateEvent): void {
    this.state.lastTickAt = Date.now();

    switch (event.type) {
      case "session_start":
        // Decay toward baseline rather than hard-resetting, so cross-session
        // signal compounds. frustration and mood hard-reset: frustration is
        // session-scoped by design, mood self-regresses each event anyway.
        this.state.confidence = clamp(this.state.confidence * 0.85 + 0.6 * 0.15);
        this.state.curiosity = clamp(this.state.curiosity * 0.85 + 0.5 * 0.15);
        this.state.frustration = 0.0;
        this.state.mood = MOOD_BASELINE;
        break;
      case "positive_interaction":
        this.state.mood = clamp(this.state.mood + event.delta);
        break;
      case "negative_interaction":
        this.state.mood = clamp(this.state.mood - event.delta);
        break;
      case "correction":
        this.state.confidence = clamp(this.state.confidence - 0.1);
        this.state.lastFailureMinAgo = 0;
        break;
      case "tool_failure":
        this.state.frustration = clamp(this.state.frustration + 0.05);
        break;
      case "successful_task":
        this.state.confidence = clamp(this.state.confidence + 0.05);
        this.state.mood = clamp(
          this.state.mood + (event.complexity === "complex" ? 0.12 : 0.05),
        );
        this.state.lastSuccessMinAgo = 0;
        break;
      case "novel_topic":
        this.state.curiosity = clamp(this.state.curiosity + 0.15);
        break;
      default:
        break;
    }

    this.state.mood += (MOOD_BASELINE - this.state.mood) * MOOD_REGRESSION_RATE;
    this.state.frustration = clamp(this.state.frustration * 0.95);
  }

  async tick(): Promise<void> {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
    const s = this.state;

    const meta = await readJsonSafe<MetaState>(META_PATH, {});
    const store = await readJsonSafe<FrameworkStore>(FRAMEWORKS_PATH, {
      version: 1,
      frameworks: [],
      meta: { totalDiscovered: 0, totalRetired: 0, totalMerged: 0, lastReflectionAt: 0, reflectionCount: 0 },
    });

    const followUpsPath = path.join(DATA_DIR, "follow-ups.json");
    const followUps = await readJsonSafe<FollowUp[]>(followUpsPath, []);

    // B-contract (issue #6): the session log persists signals across cycles
    // with per-tier `consumedBy` markers, so total-queue size no longer maps
    // to "pending". Break it down: total in log, pending-quick, pending-deep.
    let signalCount = 0;
    let correctionCount = 0;
    let pendingQuick = 0;
    let pendingDeep = 0;
    try {
      const logContent = await fs.readFile(SESSION_LOG_PATH, "utf8");
      const lines = logContent.split("\n").filter((l) => l.trim());
      signalCount = lines.length;
      correctionCount = lines.filter((l) => l.includes('"correction"')).length;
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { consumedBy?: Array<{ tier: string }> };
          const tiers = new Set((parsed.consumedBy ?? []).map((c) => c.tier));
          if (!tiers.has("quick")) pendingQuick++;
          if (!tiers.has("deep")) pendingDeep++;
        } catch {
          // malformed line — count as pending for both tiers (conservative)
          pendingQuick++;
          pendingDeep++;
        }
      }
    } catch {
      // no signals yet
    }

    const active = store.frameworks.filter((f) => f.status === "active").length;
    const questioning = store.frameworks.filter((f) => f.status === "questioning").length;
    const retired = store.frameworks.filter((f) => f.status === "retired").length;
    const unresolvedFollowUps = followUps.filter((f) => f.status !== "resolved");

    const content = `# State — ${now}

## Session
- Confidence: ${s.confidence.toFixed(2)} (${trendWord(s.confidence, 0.6)})
- Mood: ${s.mood.toFixed(2)} (${trendWord(s.mood, MOOD_BASELINE)})
- Curiosity: ${s.curiosity.toFixed(2)} (${trendWord(s.curiosity, 0.5)})
- Frustration: ${s.frustration.toFixed(2)}

## System
- Learning phase: ${meta.phase ?? "apprentice"} (${meta.reflectionCount ?? 0} reflections)
- Frameworks: ${active} active, ${questioning} questioning, ${retired} retired
- Signals: ${signalCount} total (${pendingQuick} pending quick, ${pendingDeep} pending deep, ${correctionCount} corrections)
- Unresolved follow-ups: ${unresolvedFollowUps.length}${unresolvedFollowUps.length > 0 ? "\n" + unresolvedFollowUps.map((f) => `  - ${f.summary ?? "(no summary)"}`).join("\n") : ""}
`;

    const statePath = soulFilePath("STATE.md");
    const tmpPath = `${statePath}.tmp-${process.pid}`;
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, statePath);
    await this.save();
  }

  getState(): Readonly<InternalState> {
    return { ...this.state };
  }
}
