import { FrameworkEngine } from "../engine/framework-engine.js";
import type { Framework } from "../types/learning-types.js";

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Render a single framework with full detail: description, evidence history,
 * workflows, related frameworks, and tensions.
 */
function renderFullFramework(fw: Framework): string {
  const confirmed = fw.evidence.filter((e) => e.type === "confirmed");
  const contradicted = fw.evidence.filter((e) => e.type === "contradicted");

  const lines: string[] = [];
  lines.push(`# ${fw.name}`);
  lines.push("");
  const tier = fw.evidenceTier ?? "hypothesis";
  lines.push(`**Status**: ${fw.status} | **Tier**: ${tier} | **Source**: ${fw.source}`);
  lines.push(`**Domain**: ${fw.domain} | **Applied**: ${fw.applicationCount} times | **Last tested**: ${formatDate(fw.lastTestedAt)}`);
  lines.push("");
  lines.push("## Description");
  lines.push("");
  lines.push(fw.description);

  // Evidence history
  lines.push("");
  lines.push(`## Evidence (${confirmed.length} confirmed, ${contradicted.length} contradicted)`);
  if (fw.evidence.length === 0) {
    lines.push("*(no evidence yet)*");
  } else {
    for (const e of fw.evidence) {
      lines.push(`- [${formatDate(e.timestamp)}] **${e.type}**: ${e.context}`);
    }
  }

  // Related frameworks
  if (fw.relatedFrameworks.length > 0) {
    lines.push("");
    lines.push(`## Related: ${fw.relatedFrameworks.join(", ")}`);
  }
  if (fw.contradicts.length > 0) {
    lines.push(`## Contradicts: ${fw.contradicts.join(", ")}`);
  }
  if (fw.supersedes.length > 0) {
    lines.push(`## Supersedes: ${fw.supersedes.join(", ")}`);
  }

  return lines.join("\n");
}

export async function handleSoulFramework(name: string): Promise<string> {
  const engine = new FrameworkEngine();
  const store = await engine.initialize();

  // Search by name (case-insensitive) or by ID
  const fw = store.frameworks.find(
    (f) =>
      f.name.toLowerCase() === name.toLowerCase() ||
      f.id === name,
  );

  if (!fw) {
    // Try partial match
    const partial = store.frameworks.find(
      (f) => f.name.toLowerCase().includes(name.toLowerCase()),
    );
    if (partial) {
      return renderFullFramework(partial);
    }

    const available = store.frameworks
      .filter((f) => f.status !== "retired")
      .map((f) => `- ${f.name} (${f.id})`)
      .join("\n");
    return `Framework "${name}" not found. Available:\n${available}`;
  }

  return renderFullFramework(fw);
}
