import { runReflection, runMetaReflection, type ReflectionResult } from "../engine/reflection-runner.js";
import { getSignalCount } from "../engine/signal-store.js";
import { loadMeta } from "../engine/meta-optimizer.js";

export async function handleSoulReflect(
  tier: "quick" | "deep" | "meta",
): Promise<string> {
  // Meta-reflection doesn't need signals — it audits framework state
  if (tier === "meta") {
    let result: ReflectionResult;
    try {
      result = await runMetaReflection();
    } catch (err) {
      return `Meta-reflection failed: ${err}`;
    }
    return formatReflectionResult(result);
  }

  const signalCount = await getSignalCount();

  if (signalCount === 0) {
    return "No signals to reflect on. Signals are collected automatically from conversations via the Stop hook, or you can report them with soul_signal().";
  }

  let result: ReflectionResult;
  try {
    result = await runReflection(tier);
  } catch (err) {
    return `Reflection failed: ${err}`;
  }

  const lines: string[] = [formatReflectionResult(result)];

  // Auto-chain meta-reflection on large changes or periodically
  const largeChanges = result.retired >= 2 || result.newFrameworks >= 2 || result.frameworksUpdated >= 8;
  const meta = await loadMeta();
  const periodic = meta.reflectionCount > 0 && meta.reflectionCount % 5 === 0;

  if (largeChanges || periodic) {
    const reason = largeChanges
      ? `large changes (${result.retired} retired, ${result.newFrameworks} new, ${result.frameworksUpdated} updated)`
      : `periodic audit (reflection #${meta.reflectionCount})`;

    lines.push("");
    lines.push(`Auto-chaining meta-reflection: ${reason}...`);

    try {
      const metaResult = await runMetaReflection();
      lines.push("");
      lines.push(formatReflectionResult(metaResult));
    } catch (metaErr) {
      lines.push(`Meta-reflection failed: ${metaErr}`);
    }
  }

  return lines.join("\n");
}

function formatReflectionResult(result: ReflectionResult): string {
  const tierLabel = result.tier.toUpperCase();
  const lines: string[] = [];
  lines.push(`## ${tierLabel} Reflection Complete`);

  if (result.signalsProcessed > 0) {
    lines.push(`- Signals processed: ${result.signalsProcessed}`);
  }
  if (result.frameworksUpdated > 0) {
    lines.push(`- Frameworks updated: ${result.frameworksUpdated}`);
  }
  if (result.newFrameworks > 0) {
    lines.push(`- New frameworks: ${result.newFrameworks}`);
  }
  if (result.retired > 0) {
    lines.push(`- Retired: ${result.retired}`);
  }
  if (result.lessonsGenerated > 0) {
    lines.push(`- Lessons generated: ${result.lessonsGenerated}`);
  }
  if (result.exemplarsStored > 0) {
    lines.push(`- Exemplars stored: ${result.exemplarsStored}`);
  }
  if (result.tensionsUpdated > 0) {
    lines.push(`- Tensions updated: ${result.tensionsUpdated}`);
  }
  if (result.snapshot) {
    lines.push(`- Snapshot saved (rollback available)`);
  }
  if (result.insight) {
    lines.push(`- Insight: ${result.insight}`);
  }

  return lines.join("\n");
}
