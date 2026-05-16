import type { Framework, FrameworkStore, EvidenceTier } from "../types/learning-types.js";

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function tierLabel(tier: EvidenceTier): string {
  switch (tier) {
    case "validated": return "validated";
    case "observed": return "observed";
    default: return "hypothesis";
  }
}

function renderActiveFramework(fw: Framework): string {
  const prefix = fw.source === "discovered" ? "[Discovered] " : "";
  const kindTag = fw.kind === "process" ? "[Process] " : "";
  const tier = tierLabel(fw.evidenceTier ?? "hypothesis");
  const confirmedCount = fw.evidence.filter((e) => e.type === "confirmed").length;
  const contradictedCount = fw.evidence.filter((e) => e.type === "contradicted").length;
  const externalCount = fw.evidence.filter((e) => e.type === "confirmed" && e.contextType === "external").length;

  const lines: string[] = [];
  lines.push(`### ${kindTag}${prefix}${fw.name} [${tier}]`);
  lines.push(fw.description);

  if (fw.kind === "process" && fw.triggers && fw.triggers.length > 0) {
    lines.push(`**Triggers**: ${fw.triggers.join(" | ")}`);
  }
  if (fw.kind === "process" && fw.steps && fw.steps.length > 0) {
    for (const [i, step] of fw.steps.entries()) {
      lines.push(`${i + 1}. ${step}`);
    }
  }

  lines.push(
    `*Source: ${fw.source} | Applied ${fw.applicationCount} times | Last tested: ${formatDate(fw.lastTestedAt)}*`,
  );
  const externalNote = externalCount > 0 ? `, ${externalCount} external` : "";
  lines.push(`*Confidence: ${(fw.confidence * 100).toFixed(0)}% | Evidence: ${confirmedCount} confirmed${externalNote}, ${contradictedCount} contradicted*`);

  return lines.join("\n");
}

export function renderFrameworksToMarkdown(store: FrameworkStore): string {
  const active = store.frameworks
    .filter((fw) => fw.status === "active")
    .sort((a, b) => b.confidence - a.confidence);

  const questioning = store.frameworks.filter((fw) => fw.status === "questioning");
  const retired = store.frameworks.filter((fw) => fw.status === "retired");

  const lastReflection =
    store.meta.lastReflectionAt > 0
      ? formatDate(store.meta.lastReflectionAt)
      : "never";

  const sections: string[] = [];

  sections.push("# Operating Frameworks");
  sections.push("");
  sections.push(
    `*Auto-generated from frameworks.json. ${active.length} active, ${questioning.length} questioning, ${retired.length} retired. Last reflection: ${lastReflection}*`,
  );

  sections.push("");
  sections.push("## Active Frameworks");
  sections.push("");
  if (active.length === 0) {
    sections.push("*No active frameworks yet — all are under questioning until confirmed by evidence.*");
  } else {
    sections.push(active.map(renderActiveFramework).join("\n\n"));
  }

  if (questioning.length > 0) {
    sections.push("");
    sections.push("---");
    sections.push("");
    sections.push("## Under Questioning (seed, awaiting evidence)");
    sections.push("");
    sections.push(questioning.map(renderActiveFramework).join("\n\n"));
  }

  if (retired.length > 0) {
    sections.push("");
    sections.push("---");
    sections.push("");
    sections.push("## Retired");
    sections.push("");
    for (const fw of retired) {
      const lastEvidence = fw.evidence[fw.evidence.length - 1];
      const reason = lastEvidence ? lastEvidence.context : "No reason recorded";
      sections.push(`- ~~${fw.name}~~ — *${reason}*`);
    }
  }

  return sections.join("\n");
}

/**
 * Compressed one-liner rendering for when full FRAMEWORKS.md exceeds token budget.
 * Every framework stays visible — just at reduced detail.
 */
/**
 * Minimal framework index — one line per framework with ID, name, confidence, and trigger.
 * Used in slim context so the LLM knows what exists without loading full details.
 */
export function renderFrameworkIndex(store: FrameworkStore): string {
  const frameworks = store.frameworks
    .filter((fw) => fw.status === "active" || fw.status === "questioning")
    .sort((a, b) => b.confidence - a.confidence);

  if (frameworks.length === 0) return "";

  const lines: string[] = [];
  lines.push("## Framework Index");
  lines.push("*Call soul_activate() after reading the user's first message to load relevant frameworks.*");
  lines.push("*Call soul_framework(name) to load a specific framework on demand.*");
  lines.push("");

  for (const fw of frameworks) {
    const statusPrefix = fw.status === "active" ? "+" : "?";
    const kindPrefix = fw.kind === "process" ? "P" : statusPrefix;
    const tier = tierLabel(fw.evidenceTier ?? "hypothesis");
    lines.push(`- [${kindPrefix}] **${fw.name}** [${tier}] — ${fw.description.slice(0, 80)}`);
  }

  return lines.join("\n");
}

/**
 * Compressed one-liner rendering for when full FRAMEWORKS.md exceeds token budget.
 * Every framework stays visible — just at reduced detail.
 */
export function renderFrameworksCompressed(store: FrameworkStore): string {
  const active = store.frameworks
    .filter((fw) => fw.status === "active")
    .sort((a, b) => b.confidence - a.confidence);
  const questioning = store.frameworks
    .filter((fw) => fw.status === "questioning")
    .sort((a, b) => b.confidence - a.confidence);
  const retired = store.frameworks.filter((fw) => fw.status === "retired");

  const lastReflection =
    store.meta.lastReflectionAt > 0
      ? formatDate(store.meta.lastReflectionAt)
      : "never";

  const lines: string[] = [];
  lines.push("# Frameworks (compressed)");
  lines.push("");
  lines.push(
    `*${active.length} active, ${questioning.length} questioning, ${retired.length} retired. Last reflection: ${lastReflection}*`,
  );

  if (active.length > 0) {
    lines.push("");
    lines.push("## Active");
    for (const fw of active) {
      const prefix = fw.source === "discovered" ? "[D] " : "";
      const kindTag = fw.kind === "process" ? "[P] " : "";
      const tier = tierLabel(fw.evidenceTier ?? "hypothesis");
      lines.push(
        `- ${kindTag}${prefix}**${fw.name}** [${tier}] — ${fw.description.slice(0, 120)}`,
      );
    }
  }

  if (questioning.length > 0) {
    lines.push("");
    lines.push("## Questioning");
    for (const fw of questioning) {
      const tier = tierLabel(fw.evidenceTier ?? "hypothesis");
      lines.push(
        `- **${fw.name}** [${tier}] — ${fw.description.slice(0, 120)}`,
      );
    }
  }

  if (retired.length > 0) {
    lines.push("");
    lines.push("## Retired");
    for (const fw of retired) {
      lines.push(`- ~~${fw.name}~~`);
    }
  }

  return lines.join("\n");
}

export function renderFrameworkSummary(store: FrameworkStore): string {
  const active = store.frameworks.filter((fw) => fw.status === "active").length;
  const questioning = store.frameworks.filter((fw) => fw.status === "questioning").length;
  const retired = store.frameworks.filter((fw) => fw.status === "retired").length;
  const total = store.frameworks.length;

  const lastReflection =
    store.meta.lastReflectionAt > 0
      ? formatDate(store.meta.lastReflectionAt)
      : "never";

  return `${total} frameworks (${active} active, ${questioning} questioning, ${retired} retired) | Last reflection: ${lastReflection}`;
}
