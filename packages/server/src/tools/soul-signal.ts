import crypto from "node:crypto";
import type { MicroSignal, SignalType, FrameworkStore } from "../types/learning-types.js";
import { appendSignals, getSignalCount } from "../engine/signal-store.js";
import { StateEngine } from "../engine/state-engine.js";
import { loadMeta, getReflectionThresholds } from "../engine/meta-optimizer.js";
import { readJsonSafe, FRAMEWORKS_PATH } from "../util/files.js";
import { runReflection, runMetaReflection } from "../engine/reflection-runner.js";

type SignalInput = {
  type: SignalType;
  evidence: string;
  confidence?: number;
};

export async function handleSoulSignal(signals: SignalInput[]): Promise<string> {
  const sessionKey = crypto.randomUUID().slice(0, 8);

  const microSignals: MicroSignal[] = signals.map((s) => ({
    timestamp: Date.now(),
    sessionKey,
    type: s.type,
    evidence: s.evidence.slice(0, 200),
    source: "user" as const,
    confidence: s.confidence ?? 0.7,
    userSnippets: [],
    assistantSnippets: [],
    consumedBy: [],
  }));

  await appendSignals(microSignals);

  // Update state based on signals
  const stateEngine = new StateEngine();
  await stateEngine.load();

  for (const signal of microSignals) {
    switch (signal.type) {
      case "correction":
        stateEngine.recordEvent({ type: "correction" });
        break;
      case "gratitude":
        stateEngine.recordEvent({ type: "positive_interaction", delta: 0.1 });
        break;
      case "success":
        stateEngine.recordEvent({ type: "successful_task", complexity: "complex" });
        break;
      case "confusion":
        stateEngine.recordEvent({ type: "negative_interaction", delta: 0.05 });
        break;
      case "topic_shift":
        stateEngine.recordEvent({ type: "novel_topic" });
        break;
    }
  }

  await stateEngine.tick();

  const lines: string[] = [];
  lines.push(`Recorded ${microSignals.length} signal(s): ${microSignals.map((s) => s.type).join(", ")}`);

  // Check if reflection should trigger (Option B: self-triggering)
  const totalSignals = await getSignalCount();
  const meta = await loadMeta();
  const thresholds = getReflectionThresholds(meta);

  const store = await readJsonSafe<FrameworkStore>(FRAMEWORKS_PATH, {
    version: 1 as const,
    frameworks: [],
    meta: { totalDiscovered: 0, totalRetired: 0, totalMerged: 0, lastReflectionAt: 0, reflectionCount: 0 },
  });
  const timeSinceReflection = Date.now() - store.meta.lastReflectionAt;

  let tier: "quick" | "deep" | null = null;

  if (totalSignals >= thresholds.minSignals) {
    if (
      totalSignals >= thresholds.deepSignals ||
      (timeSinceReflection >= thresholds.deepTimeMs && totalSignals >= thresholds.minSignals)
    ) {
      tier = "deep";
    } else if (
      totalSignals >= thresholds.quickSignals ||
      (timeSinceReflection >= thresholds.quickTimeMs && totalSignals >= thresholds.minSignals)
    ) {
      tier = "quick";
    }
  }

  if (tier) {
    lines.push("");
    lines.push(`Threshold reached (${totalSignals} signals, phase: ${meta.phase}). Triggering ${tier} reflection...`);

    try {
      const result = await runReflection(tier);
      lines.push("");
      lines.push(`## ${tier.toUpperCase()} Reflection Complete`);
      lines.push(`- Frameworks updated: ${result.frameworksUpdated}`);
      if (result.newFrameworks > 0) lines.push(`- New frameworks: ${result.newFrameworks}`);
      if (result.retired > 0) lines.push(`- Retired: ${result.retired}`);
      if (result.lessonsGenerated > 0) lines.push(`- Lessons: ${result.lessonsGenerated}`);
      if (result.insight) lines.push(`- Insight: ${result.insight}`);

      // Auto-chain meta-reflection when reflection made large changes or periodically
      const largeChanges = result.retired >= 2 || result.newFrameworks >= 2 || result.frameworksUpdated >= 8;
      const updatedMeta = await loadMeta();
      const periodic = updatedMeta.reflectionCount > 0 && updatedMeta.reflectionCount % 5 === 0;

      if (largeChanges || periodic) {
        const reason = largeChanges
          ? `large changes detected (${result.retired} retired, ${result.newFrameworks} new, ${result.frameworksUpdated} updated)`
          : `periodic audit (every 5th reflection, count: ${updatedMeta.reflectionCount})`;

        lines.push("");
        lines.push(`Auto-triggering meta-reflection: ${reason}...`);

        try {
          const metaResult = await runMetaReflection();
          lines.push("");
          lines.push("## META Reflection Complete");
          if (metaResult.frameworksUpdated > 0) lines.push(`- Frameworks adjusted: ${metaResult.frameworksUpdated}`);
          if (metaResult.retired > 0) lines.push(`- Retired: ${metaResult.retired}`);
          if (metaResult.tensionsUpdated > 0) lines.push(`- Tensions updated: ${metaResult.tensionsUpdated}`);
          if (metaResult.insight) lines.push(`- Insight: ${metaResult.insight}`);
        } catch (metaErr) {
          lines.push(`Meta-reflection failed: ${metaErr}`);
        }
      }
    } catch (err) {
      lines.push(`Reflection failed: ${err}`);
    }
  } else {
    lines.push(`(${totalSignals}/${thresholds.quickSignals} signals for next quick reflection)`);
  }

  return lines.join("\n");
}
