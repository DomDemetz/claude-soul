import type { Framework, LLMReflectionResult, TensionState } from "../types/learning-types.js";
import type { SoulConfig } from "../types/config-types.js";
import { FrameworkEngine } from "./framework-engine.js";
import { renderFrameworksToMarkdown } from "./framework-renderer.js";
import { buildQuickReflectionPrompt, buildDeepReflectionPrompt, buildMetaReflectionPrompt } from "./prompt-builder.js";
import { createSnapshot } from "./snapshot-manager.js";
import { readSignals, clearSignals } from "./signal-store.js";
import { detectTensions } from "./tension-detector.js";
import { updateMetaAfterReflection, loadMeta, getPhaseGuidance } from "./meta-optimizer.js";
import {
  readFileSafe,
  soulFilePath,
  loadConfig,
  TENSIONS_PATH,
  LESSONS_PATH,
  EXEMPLARS_PATH,
} from "../util/files.js";
import { readJsonSafe, writeJsonAtomic } from "../util/files.js";
import type { Lesson, Exemplar } from "../types/learning-types.js";
import fs from "node:fs/promises";
import { callClaude, parseLlmJson as parseReflectionJson } from "../util/llm.js";

type ParsedTensionUpdate = {
  frameworkA: string;
  frameworkB: string;
  status: string;
  preferredContext?: string;
  preferred?: string;
  evidence: string;
};

type ParsedFrameworkEvolution = {
  frameworkId: string;
  action: string;
  detail: string;
  status?: string;
};

type ParsedNewFramework = {
  name: string;
  description: string;
  domain: string;
  confidence: number;
};

/** Apply tension updates from a parsed reflection response. Returns count of updates. */
async function applyTensionUpdates(
  updates: ParsedTensionUpdate[],
  tensionState: TensionState,
): Promise<number> {
  if (updates.length === 0) return 0;

  for (const tu of updates) {
    const existing = tensionState.tensions.find(
      (t) =>
        (t.frameworkA === tu.frameworkA && t.frameworkB === tu.frameworkB) ||
        (t.frameworkA === tu.frameworkB && t.frameworkB === tu.frameworkA),
    );

    if (existing) {
      existing.status = tu.status as typeof existing.status;
      if (tu.preferredContext && tu.preferred) {
        existing.preferredInContext[tu.preferredContext] = {
          preferred: tu.preferred,
          confirmedCount: (existing.preferredInContext[tu.preferredContext]?.confirmedCount ?? 0) + 1,
          evidence: [
            ...(existing.preferredInContext[tu.preferredContext]?.evidence ?? []),
            tu.evidence,
          ].slice(-5),
        };
      }
    } else {
      tensionState.tensions.push({
        id: `ten-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        frameworkA: tu.frameworkA,
        frameworkB: tu.frameworkB,
        description: `${tu.frameworkA} vs ${tu.frameworkB}`,
        preferredInContext: tu.preferredContext && tu.preferred
          ? {
              [tu.preferredContext]: {
                preferred: tu.preferred,
                confirmedCount: 1,
                evidence: [tu.evidence],
              },
            }
          : {},
        status: (tu.status as "detected" | "holding" | "resolved" | "integrated") ?? "detected",
        detectedAt: Date.now(),
      });
    }
  }

  await writeJsonAtomic(TENSIONS_PATH, tensionState);
  return updates.length;
}

/** Apply framework evolutions (refine/retire). Returns {updated, retired} counts. */
async function applyFrameworkEvolutions(
  evolutions: ParsedFrameworkEvolution[],
  engine: FrameworkEngine,
): Promise<{ updated: number; retired: number }> {
  let updated = 0;
  let retired = 0;

  for (const evo of evolutions) {
    if (evo.action === "retire") {
      await engine.retireFramework(evo.frameworkId, evo.detail);
      retired++;
    } else if (evo.action === "refine") {
      const changes: { description?: string; status?: Framework["status"] } = {};
      if (evo.detail) changes.description = evo.detail;
      if (evo.status) {
        const validStatuses = ["active", "questioning", "retired"] as const;
        const newStatus = validStatuses.find((s) => s === evo.status);
        if (newStatus) changes.status = newStatus;
      }
      await engine.evolveFramework(evo.frameworkId, changes);
      updated++;
    }
  }

  return { updated, retired };
}

/** Add newly discovered frameworks. Returns count. */
async function applyNewFrameworks(
  frameworks: ParsedNewFramework[],
  engine: FrameworkEngine,
  maxConfidence: number,
): Promise<number> {
  for (const nf of frameworks) {
    await engine.addDiscoveredFramework({
      ...nf,
      confidence: Math.min(nf.confidence, maxConfidence),
    });
  }
  return frameworks.length;
}

/** Finalize a reflection: re-render FRAMEWORKS.md, bump meta counters, write log. */
async function finalizeReflection(
  engine: FrameworkEngine,
  tier: string,
  result: ReflectionResult,
  extraLogLines?: string[],
): Promise<void> {
  const updatedStore = await engine.loadStore();
  const frameworksMd = renderFrameworksToMarkdown(updatedStore);
  await fs.writeFile(soulFilePath("FRAMEWORKS.md"), frameworksMd, "utf-8");

  updatedStore.meta.reflectionCount++;
  updatedStore.meta.lastReflectionAt = Date.now();
  await engine.saveStore(updatedStore);
  await updateMetaAfterReflection(updatedStore);

  // Log
  const date = new Date().toISOString().slice(0, 10);
  const logPath = `${soulFilePath("..").replace("/files", "/reflections")}/${date}.md`;
  const logEntry = [
    `\n## ${tier.toUpperCase()} Reflection — ${new Date().toISOString()}`,
    result.signalsProcessed > 0 ? `- Signals processed: ${result.signalsProcessed}` : "",
    `- Frameworks updated: ${result.frameworksUpdated}`,
    result.newFrameworks > 0 ? `- New frameworks: ${result.newFrameworks}` : "",
    result.retired > 0 ? `- Retired: ${result.retired}` : "",
    result.lessonsGenerated > 0 ? `- Lessons: ${result.lessonsGenerated}` : "",
    result.exemplarsStored > 0 ? `- Exemplars: ${result.exemplarsStored}` : "",
    result.tensionsUpdated > 0 ? `- Tensions: ${result.tensionsUpdated}` : "",
    ...(extraLogLines ?? []),
    result.insight ? `- Insight: ${result.insight}` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  await fs.appendFile(logPath, logEntry, "utf-8").catch(() => {});
}


export type ReflectionResult = {
  tier: "quick" | "deep" | "meta";
  frameworksUpdated: number;
  newFrameworks: number;
  retired: number;
  lessonsGenerated: number;
  exemplarsStored: number;
  tensionsUpdated: number;
  signalsProcessed: number;
  snapshot: string;
  insight: string | null;
};

export async function runReflection(
  tier: "quick" | "deep",
): Promise<ReflectionResult> {
  const config = await loadConfig();
  const frameworkEngine = new FrameworkEngine();
  const store = await frameworkEngine.initialize();
  const signals = await readSignals();

  if (signals.length === 0) {
    return {
      tier,
      frameworksUpdated: 0,
      newFrameworks: 0,
      retired: 0,
      lessonsGenerated: 0,
      exemplarsStored: 0,
      tensionsUpdated: 0,
      signalsProcessed: 0,
      snapshot: "",
      insight: null,
    };
  }

  const snapshot = await createSnapshot();

  // Build prompt
  let prompt: string;
  if (tier === "quick") {
    prompt = buildQuickReflectionPrompt({ signals, frameworks: store.frameworks });
  } else {
    const shadow = await readFileSafe(soulFilePath("SHADOW.md"));
    const growth = await readFileSafe(soulFilePath("GROWTH.md"));
    const tensionState = await readJsonSafe<TensionState>(TENSIONS_PATH, { tensions: [] });
    const meta = await loadMeta();
    prompt = buildDeepReflectionPrompt({
      signals,
      frameworks: store.frameworks,
      tensions: tensionState.tensions,
      shadow,
      growth,
      phaseGuidance: getPhaseGuidance(meta),
    });
  }

  const model = tier === "quick" ? config.reflection.quickModel : config.reflection.deepModel;
  const responseText = await callClaude(prompt, model);
  const parsed = parseReflectionJson(responseText);
  if (!parsed) throw new Error("Failed to parse reflection response as JSON");

  const result: ReflectionResult = {
    tier,
    frameworksUpdated: 0,
    newFrameworks: 0,
    retired: 0,
    lessonsGenerated: 0,
    exemplarsStored: 0,
    tensionsUpdated: 0,
    signalsProcessed: signals.length,
    snapshot,
    insight: null,
  };

  // Apply framework tests
  const frameworkTests = (parsed.frameworkTests as Array<{
    frameworkId: string;
    result: string;
    evidence: string;
    contextType?: string;
  }>) ?? [];

  for (const test of frameworkTests) {
    if (test.result === "irrelevant") continue;
    if (test.result === "confirmed" || test.result === "contradicted") {
      const contextType = test.contextType === "external" ? "external"
        : test.contextType === "self-referential" ? "self-referential"
        : "unknown" as const;
      await frameworkEngine.recordEvidence(test.frameworkId, {
        timestamp: Date.now(),
        type: test.result as "confirmed" | "contradicted",
        context: test.evidence,
        contextType,
      });
      result.frameworksUpdated++;
    }
  }

  // Apply shared mutations
  result.newFrameworks = await applyNewFrameworks(
    (parsed.newFrameworks as ParsedNewFramework[]) ?? [], frameworkEngine, 0.4,
  );
  const evoResult = await applyFrameworkEvolutions(
    (parsed.frameworkEvolutions as ParsedFrameworkEvolution[]) ?? [], frameworkEngine,
  );
  result.frameworksUpdated += evoResult.updated;
  result.retired = evoResult.retired;

  // Deep reflection: apply lessons, exemplars, tensions
  if (tier === "deep") {
    const lessons = (parsed.lessons as Array<{
      lesson: string; context: string; confidence: number; evidence: string;
    }>) ?? [];

    if (lessons.length > 0) {
      const existingLessons = await readJsonSafe<Lesson[]>(LESSONS_PATH, []);
      const newLessons: Lesson[] = lessons.map((l) => ({
        id: `les-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        lesson: l.lesson, context: l.context, confidence: l.confidence,
        evidence: [l.evidence], createdAt: Date.now(),
      }));
      await writeJsonAtomic(LESSONS_PATH, [...existingLessons, ...newLessons].slice(-config.lessons.maxCount));
      result.lessonsGenerated = newLessons.length;
    }

    const exemplarCandidates = (parsed.exemplarCandidates as Array<{
      context: string; responseExcerpt: string; signals: string[];
    }>) ?? [];

    if (exemplarCandidates.length > 0) {
      const existingExemplars = await readJsonSafe<Exemplar[]>(EXEMPLARS_PATH, []);
      const activeNames = store.frameworks.filter((f) => f.status === "active").map((f) => f.name);
      const newExemplars: Exemplar[] = exemplarCandidates.map((e) => ({
        id: `ex-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        context: e.context.slice(0, 200), responseExcerpt: e.responseExcerpt.slice(0, 500),
        frameworksActive: activeNames.slice(0, 5), domain: "general",
        signals: e.signals, createdAt: Date.now(),
      }));
      await writeJsonAtomic(EXEMPLARS_PATH, [...existingExemplars, ...newExemplars].slice(-config.exemplars.maxCount));
      result.exemplarsStored = newExemplars.length;
    }

    const tensionState = await readJsonSafe<TensionState>(TENSIONS_PATH, { tensions: [] });
    result.tensionsUpdated = await applyTensionUpdates(
      (parsed.tensionUpdates as ParsedTensionUpdate[]) ?? [], tensionState,
    );

    // Auto-detect tensions
    const updatedStore = await frameworkEngine.loadStore();
    const newTensions = await detectTensions(updatedStore.frameworks);
    result.tensionsUpdated += newTensions.length;
  }

  // Store insight
  result.insight = (parsed.emergentInsight as string) ?? (parsed.soulEvolution as string) ?? null;
  const meta = await loadMeta();
  if (meta.phase !== "apprentice") {
    result.insight = `[Phase: ${meta.phase}] ${result.insight ?? ""}`.trim();
  }

  await finalizeReflection(frameworkEngine, tier, result);
  await clearSignals();

  return result;
}

/**
 * Run a meta-reflection — audits framework state coherence, confidence calibration,
 * redundancy, and self-referential evidence. Does not consume signals.
 */
export async function runMetaReflection(): Promise<ReflectionResult> {
  const config = await loadConfig();
  const frameworkEngine = new FrameworkEngine();
  const store = await frameworkEngine.initialize();
  const snapshot = await createSnapshot();

  const growth = await readFileSafe(soulFilePath("GROWTH.md"));
  const tensionState = await readJsonSafe<TensionState>(TENSIONS_PATH, { tensions: [] });
  const meta = await loadMeta();

  const prompt = buildMetaReflectionPrompt({
    frameworks: store.frameworks,
    tensions: tensionState.tensions,
    growth,
    recentReflectionCount: meta.reflectionCount,
  });

  const responseText = await callClaude(prompt, config.reflection.deepModel);
  const parsed = parseReflectionJson(responseText);
  if (!parsed) throw new Error("Failed to parse meta-reflection response as JSON");

  const result: ReflectionResult = {
    tier: "meta",
    frameworksUpdated: 0,
    newFrameworks: 0,
    retired: 0,
    lessonsGenerated: 0,
    exemplarsStored: 0,
    tensionsUpdated: 0,
    signalsProcessed: 0,
    snapshot,
    insight: null,
  };

  // Apply tier adjustments (meta-specific: updates evidence tiers based on audit)
  const adjustments = (parsed.tierAdjustments as Array<{
    frameworkId: string; recommendedTier: string; reason: string;
  }>) ?? [];

  let tierChanges = 0;
  for (const adj of adjustments) {
    const fw = store.frameworks.find((f) => f.id === adj.frameworkId);
    if (!fw) continue;
    const validTiers = ["hypothesis", "observed", "validated"] as const;
    const newTier = validTiers.find((t) => t === adj.recommendedTier);
    if (newTier && newTier !== fw.evidenceTier) {
      fw.evidenceTier = newTier;
      fw.version++;
      tierChanges++;
      result.frameworksUpdated++;
    }
  }

  // After tier adjustments, recalculate statuses (promotion/demotion)
  if (tierChanges > 0) {
    frameworkEngine.recalculateAllStatuses(store);
    await frameworkEngine.saveStore(store);
  }

  // Apply shared mutations
  const evoResult = await applyFrameworkEvolutions(
    (parsed.frameworkEvolutions as ParsedFrameworkEvolution[]) ?? [], frameworkEngine,
  );
  result.frameworksUpdated += evoResult.updated;
  result.retired = evoResult.retired;
  result.newFrameworks = await applyNewFrameworks(
    (parsed.newFrameworks as ParsedNewFramework[]) ?? [], frameworkEngine, 0.3,
  );
  result.tensionsUpdated = await applyTensionUpdates(
    (parsed.tensionUpdates as ParsedTensionUpdate[]) ?? [], tensionState,
  );

  result.insight = (parsed.emergentInsight as string) ?? null;

  // Meta-specific log lines
  const selfRefFlags = (parsed.selfReferentialFlags as Array<{ frameworkId: string }>) ?? [];
  const redundancyFlags = (parsed.redundancyFlags as Array<{ frameworkA: string }>) ?? [];
  await finalizeReflection(frameworkEngine, "meta", result, [
    `- Confidence adjustments: ${adjustments.length}`,
    `- Self-referential flags: ${selfRefFlags.length}`,
    `- Redundancy flags: ${redundancyFlags.length}`,
  ]);

  return result;
}
