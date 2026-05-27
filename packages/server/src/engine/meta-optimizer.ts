import type { FrameworkStore } from "../types/learning-types.js";
import { META_PATH } from "../util/files.js";
import { readJsonSafe, writeJsonAtomic } from "../util/files.js";

export type MetaState = {
  phase: "apprentice" | "creative" | "mastery";
  frameworkSurvivalRate: number;
  reflectionCount: number;
  totalDiscovered: number;
  totalRetired: number;
  oscillationFlags: string[];
  lastPhaseTransition: number;
  phaseHistory: Array<{
    phase: string;
    enteredAt: number;
    reason: string;
  }>;
};

const DEFAULT_META: MetaState = {
  phase: "apprentice",
  frameworkSurvivalRate: 1.0,
  reflectionCount: 0,
  totalDiscovered: 0,
  totalRetired: 0,
  oscillationFlags: [],
  lastPhaseTransition: Date.now(),
  phaseHistory: [{ phase: "apprentice", enteredAt: Date.now(), reason: "initial" }],
};

export async function loadMeta(): Promise<MetaState> {
  const loaded = await readJsonSafe<MetaState>(META_PATH, { ...DEFAULT_META });
  // Merge defaults so a meta.json written by an older schema doesn't leave
  // required fields undefined. getPhaseGuidance() and updateMetaAfterReflection()
  // dereference oscillationFlags / phaseHistory as arrays and would otherwise
  // throw "Cannot read properties of undefined (reading 'length')".
  return { ...DEFAULT_META, ...loaded };
}

export async function saveMeta(meta: MetaState): Promise<void> {
  await writeJsonAtomic(META_PATH, meta);
}

/**
 * Update meta-optimization state after a reflection.
 */
export async function updateMetaAfterReflection(store: FrameworkStore): Promise<MetaState> {
  const meta = await loadMeta();

  meta.reflectionCount = store.meta.reflectionCount;
  meta.totalDiscovered = store.meta.totalDiscovered;
  meta.totalRetired = store.meta.totalRetired;

  // Calculate framework survival rate
  if (meta.totalDiscovered > 0) {
    meta.frameworkSurvivalRate = 1 - (meta.totalRetired / meta.totalDiscovered);
  }

  // Detect phase transitions based on framework stability
  const activeCount = store.frameworks.filter(
    (f) => f.status === "active" || f.status === "questioning",
  ).length;
  const avgConfidence =
    store.frameworks
      .filter((f) => f.status === "active")
      .reduce((sum, f) => sum + f.confidence, 0) /
    Math.max(1, store.frameworks.filter((f) => f.status === "active").length);

  const prevPhase = meta.phase;

  if (meta.phase === "apprentice") {
    // Transition to creative: 5+ active frameworks with avg confidence > 0.5
    const activeHighConf = store.frameworks.filter(
      (f) => f.status === "active" && f.confidence > 0.5,
    ).length;
    if (activeHighConf >= 5 && meta.reflectionCount >= 5) {
      meta.phase = "creative";
      meta.lastPhaseTransition = Date.now();
      meta.phaseHistory.push({
        phase: "creative",
        enteredAt: Date.now(),
        reason: `${activeHighConf} high-confidence frameworks, ${meta.reflectionCount} reflections`,
      });
    }
  } else if (meta.phase === "creative") {
    // Transition to mastery: 10+ active frameworks with avg confidence > 0.7, low churn
    const activeHighConf = store.frameworks.filter(
      (f) => f.status === "active" && f.confidence > 0.7,
    ).length;
    const churnRate = meta.totalRetired / Math.max(1, meta.reflectionCount);
    if (activeHighConf >= 10 && churnRate < 0.3 && meta.reflectionCount >= 20) {
      meta.phase = "mastery";
      meta.lastPhaseTransition = Date.now();
      meta.phaseHistory.push({
        phase: "mastery",
        enteredAt: Date.now(),
        reason: `${activeHighConf} high-confidence frameworks, churn rate ${churnRate.toFixed(2)}`,
      });
    }
  }

  // Detect oscillation: framework discovered then retired then re-discovered
  const retiredNames = new Set(
    store.frameworks.filter((f) => f.status === "retired").map((f) => f.name.toLowerCase()),
  );
  const activeNames = store.frameworks
    .filter((f) => f.status === "active" || f.status === "questioning")
    .map((f) => f.name.toLowerCase());

  for (const name of activeNames) {
    if (retiredNames.has(name) && !meta.oscillationFlags.includes(name)) {
      meta.oscillationFlags.push(name);
    }
  }

  // Keep oscillation flags manageable
  meta.oscillationFlags = meta.oscillationFlags.slice(-10);

  await saveMeta(meta);

  return meta;
}

/**
 * Get phase-adaptive reflection thresholds.
 * Apprentice phase needs tight loops for fast learning.
 * Mastery phase can afford slower, more deliberate reflection.
 */
export function getReflectionThresholds(meta: MetaState): {
  quickSignals: number;
  deepSignals: number;
  quickTimeMs: number;
  deepTimeMs: number;
  minSignals: number;
} {
  switch (meta.phase) {
    case "apprentice":
      return {
        quickSignals: 5,
        deepSignals: 25,
        quickTimeMs: 2 * 60 * 60 * 1000,   // 2 hours
        deepTimeMs: 12 * 60 * 60 * 1000,    // 12 hours
        minSignals: 3,
      };
    case "creative":
      return {
        quickSignals: 12,
        deepSignals: 60,
        quickTimeMs: 4 * 60 * 60 * 1000,   // 4 hours
        deepTimeMs: 24 * 60 * 60 * 1000,    // 24 hours
        minSignals: 3,
      };
    case "mastery":
      return {
        quickSignals: 20,
        deepSignals: 100,
        quickTimeMs: 6 * 60 * 60 * 1000,   // 6 hours
        deepTimeMs: 48 * 60 * 60 * 1000,    // 48 hours
        minSignals: 3,
      };
  }
}

/**
 * Decide which reflection tier (if any) should fire given per-tier unconsumed
 * counts and elapsed time since the last reflection. Pure policy function;
 * filesystem and trigger wiring live in on-stop.ts.
 *
 * The B contract for issue #6 requires per-tier counts (not raw queue size)
 * because signals now persist across reflections via `consumedBy` tracking.
 *
 * Deep wins ties with quick when both cross their count threshold so the
 * higher-evidence reflection actually fires on rich evidence — that was the
 * original intent of the tier system and what pre-#6 wipe semantics defeated.
 *
 * Time fallback requires the tier's unconsumed count to meet `minSignals`,
 * which prevents a 24h-elapsed sparse-trailing trigger on near-empty state.
 */
export function selectReflectionTier(input: {
  quickUnconsumed: number;
  deepUnconsumed: number;
  timeSinceReflectionMs: number;
  thresholds: {
    minSignals: number;
    quickSignals: number;
    deepSignals: number;
    quickTimeMs: number;
    deepTimeMs: number;
  };
  enabled: boolean;
}): "quick" | "deep" | null {
  const { quickUnconsumed, deepUnconsumed, timeSinceReflectionMs, thresholds, enabled } = input;
  if (!enabled) return null;

  const deepCountReached = deepUnconsumed >= thresholds.deepSignals;
  const deepTimeReached =
    timeSinceReflectionMs >= thresholds.deepTimeMs && deepUnconsumed >= thresholds.minSignals;
  if (deepCountReached || deepTimeReached) return "deep";

  const quickCountReached = quickUnconsumed >= thresholds.quickSignals;
  const quickTimeReached =
    timeSinceReflectionMs >= thresholds.quickTimeMs && quickUnconsumed >= thresholds.minSignals;
  if (quickCountReached || quickTimeReached) return "quick";

  return null;
}

/**
 * Get guidance for the reflection prompt based on current phase and quality metrics.
 */
export function getPhaseGuidance(meta: MetaState): string {
  const lines: string[] = [];

  switch (meta.phase) {
    case "apprentice":
      lines.push("PHASE: Apprentice — Cast a wide net. Discover many frameworks. Accept high churn.");
      lines.push("Focus on signal quality and identifying which thinking strategies the user values.");
      break;
    case "creative":
      lines.push("PHASE: Creative-Active — Refine and merge frameworks. Lower churn, higher precision.");
      lines.push("Look for connections between frameworks. Build the latticework.");
      break;
    case "mastery":
      lines.push("PHASE: Mastery — Distill. Fewer, more powerful frameworks. Meta-optimize the reflection process.");
      lines.push("Focus on depth over breadth. Merge overlapping frameworks.");
      break;
  }

  if (meta.frameworkSurvivalRate < 0.3) {
    lines.push("WARNING: Framework survival rate is low (<30%). Focus on higher-evidence patterns before proposing new frameworks.");
  }

  if (meta.oscillationFlags.length > 0) {
    lines.push(`WARNING: Oscillation detected for: ${meta.oscillationFlags.join(", ")}. Mark these as inconclusive — stop re-discovering and re-retiring.`);
  }

  return lines.join("\n");
}
