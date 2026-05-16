import { FrameworkEngine } from "../engine/framework-engine.js";
import type { Framework } from "../types/learning-types.js";
import { callClaude, parseLlmJson } from "../util/llm.js";
import { loadConfig } from "../util/files.js";

/**
 * Build the activation prompt — asks an LLM to select relevant frameworks for this conversation.
 */
function buildActivationPrompt(
  frameworks: Framework[],
  userMessage: string,
): string {
  const eligible = frameworks
    .filter((f) => f.status === "active" || f.status === "questioning")
    .sort((a, b) => b.confidence - a.confidence);

  const models = eligible.filter((f) => f.kind !== "process");
  const processes = eligible.filter((f) => f.kind === "process");

  const modelIndex = models
    .map((f) => {
      const tier = f.evidenceTier ?? "hypothesis";
      return `- ${f.id}: ${f.name} [${tier}] (${f.status}) — ${f.description.slice(0, 150)}`;
    })
    .join("\n");

  const processIndex = processes
    .map((f) => {
      const tier = f.evidenceTier ?? "hypothesis";
      const triggers = (f.triggers ?? []).slice(0, 3).join("; ");
      return `- ${f.id}: ${f.name} [${tier}] (${f.status}) — Triggers: ${triggers}`;
    })
    .join("\n");

  return [
    "You are selecting thinking frameworks for an upcoming conversation.",
    "",
    "## Available Mental Models (thinking vocabulary)",
    "",
    modelIndex || "  (none)",
    "",
    "## Available Cognitive Processes (actionable checklists)",
    "",
    processIndex || "  (none)",
    "",
    "## User's First Message",
    "",
    userMessage,
    "",
    "## Task",
    "",
    "Select 5-8 mental models most relevant as thinking vocabulary for this conversation.",
    "Also select 0-2 cognitive processes whose triggers match the conversation type.",
    "Only select processes when their triggers clearly apply — do not over-activate.",
    "",
    "Consider: the topic, type of task (building, debugging, explaining, reviewing, discussing),",
    "and which named concepts are most likely to be useful.",
    "",
    "Also classify the conversation type for future context-tagging.",
    "",
    "## JSON Output",
    "",
    "Respond with ONLY a valid JSON object:",
    "",
    "```json",
    JSON.stringify({
      conversationType: "building|debugging|explaining|reviewing|meta|general",
      selectedIds: ["framework-id-1", "framework-id-2"],
      selectedProcessIds: ["process-id-1"],
      reasoning: "brief explanation",
    }, null, 2),
    "```",
  ].join("\n");
}

/**
 * Render selected frameworks as a concept vocabulary for this conversation.
 */
function renderSelectedFrameworks(
  frameworks: Framework[],
  conversationType: string,
): string {
  const models = frameworks.filter((f) => f.kind !== "process");
  const processes = frameworks.filter((f) => f.kind === "process");

  const lines: string[] = [];
  lines.push(`## Activated Frameworks (${conversationType})`);
  lines.push("");
  lines.push("Named concepts selected for this conversation. Apply as thinking vocabulary when relevant:");
  lines.push("");

  for (const fw of models) {
    const tier = fw.evidenceTier ?? "hypothesis";
    lines.push(`### ${fw.name} [${tier}]`);
    lines.push(fw.description);
    lines.push("");
  }

  if (processes.length > 0) {
    lines.push("## Active Cognitive Processes");
    lines.push("");
    lines.push("Procedures to follow when triggered. These are active checklists, not optional vocabulary.");
    lines.push("");
    for (const p of processes) {
      const tier = p.evidenceTier ?? "hypothesis";
      lines.push(`### ${p.name} [${tier}]`);
      lines.push(p.description);
      if (p.triggers && p.triggers.length > 0) {
        lines.push(`**Triggers**: ${p.triggers.join(" | ")}`);
      }
      if (p.steps && p.steps.length > 0) {
        for (const [i, step] of p.steps.entries()) {
          lines.push(`${i + 1}. ${step}`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function handleSoulActivate(
  firstMessage: string,
): Promise<string> {
  const config = await loadConfig();
  const engine = new FrameworkEngine();
  const store = await engine.initialize();

  const eligible = store.frameworks.filter(
    (f) => f.status === "active" || f.status === "questioning",
  );

  // If few enough frameworks, skip the LLM call and return all
  if (eligible.length <= 8) {
    return renderSelectedFrameworks(eligible, "general");
  }

  const prompt = buildActivationPrompt(store.frameworks, firstMessage);
  let responseText: string;
  try {
    responseText = await callClaude(prompt, config.reflection.quickModel);
  } catch (err) {
    // Fallback: return top 8 by confidence if LLM call fails
    const fallback = eligible
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);
    return renderSelectedFrameworks(fallback, "general") +
      "\n\n*(Activation used confidence-based fallback — LLM selection unavailable)*";
  }

  const parsed = parseLlmJson(responseText);
  if (!parsed) {
    const fallback = eligible
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);
    return renderSelectedFrameworks(fallback, "general") +
      "\n\n*(Activation used confidence-based fallback — could not parse LLM response)*";
  }

  const selectedIds = (parsed.selectedIds as string[]) ?? [];
  const selectedProcessIds = (parsed.selectedProcessIds as string[]) ?? [];
  const allSelectedIds = [...new Set([...selectedIds, ...selectedProcessIds])];
  const conversationType = (parsed.conversationType as string) ?? "general";

  const selected = store.frameworks.filter((f) => allSelectedIds.includes(f.id));

  // If LLM selected nothing useful, fall back to top by confidence
  if (selected.length === 0) {
    const fallback = eligible
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);
    return renderSelectedFrameworks(fallback, conversationType);
  }

  return renderSelectedFrameworks(selected, conversationType);
}
