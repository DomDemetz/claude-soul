import type { FrameworkStore, Framework, MicroSignal } from "../types/learning-types.js";
import type { InternalState, Exemplar, Lesson } from "../types/learning-types.js";
import type { TensionState } from "../types/learning-types.js";
import { renderFrameworksToMarkdown, renderFrameworksCompressed } from "./framework-renderer.js";
import { transformShadowContent } from "./shadow-transform.js";
import { applyTokenBudget, type ContentBlock } from "./token-budget.js";
import { readUnconsumed } from "./signal-store.js";
import {
  soulFilePath,
  readFileSafe,
  FRAMEWORKS_PATH,
  TENSIONS_PATH,
  EXEMPLARS_PATH,
  LESSONS_PATH,
} from "../util/files.js";
import { readJsonSafe } from "../util/files.js";
import { selectTopLessons } from "./lesson-store.js";
import { FrameworkEngine } from "./framework-engine.js";
import type { SoulConfig } from "../types/config-types.js";

function renderFrameworkVocabulary(store: FrameworkStore): string {
  const models = store.frameworks
    .filter((f) => (f.status === "active" || f.status === "questioning") && f.kind !== "process")
    .sort((a, b) => b.confidence - a.confidence);

  if (models.length === 0) return "";

  const lines: string[] = [];
  lines.push("## Active Thinking Frameworks");
  lines.push("");
  lines.push("Named concepts available as thinking vocabulary. Apply when relevant:");
  lines.push("");

  for (const fw of models) {
    const tier = fw.evidenceTier ?? "hypothesis";
    lines.push(`- **${fw.name}** [${tier}]: ${fw.description.slice(0, 150)}`);
  }

  return lines.join("\n");
}

function renderProcessFrameworks(store: FrameworkStore): string {
  const processes = store.frameworks
    .filter((f) => (f.status === "active" || f.status === "questioning") && f.kind === "process")
    .sort((a, b) => b.confidence - a.confidence);

  if (processes.length === 0) return "";

  const lines: string[] = [];
  lines.push("## Active Cognitive Processes");
  lines.push("");
  lines.push("Procedures to follow when triggered. Check triggers against current task:");
  lines.push("");

  for (const fw of processes) {
    const tier = fw.evidenceTier ?? "hypothesis";
    const triggers = (fw.triggers ?? []).join(" | ");
    lines.push(`- **${fw.name}** [${tier}]: ${triggers}`);
  }

  return lines.join("\n");
}

function renderRecentSignals(signals: MicroSignal[]): string {
  if (signals.length === 0) return "";

  const grouped = new Map<string, MicroSignal[]>();
  for (const s of signals) {
    const list = grouped.get(s.type) ?? [];
    list.push(s);
    grouped.set(s.type, list);
  }

  const lines: string[] = [];
  lines.push("## Recent Patterns");
  lines.push("");

  for (const [type, group] of grouped) {
    const mostRecent = group[group.length - 1];
    lines.push(`- ${group.length} ${type} signal(s): "${mostRecent.evidence.slice(0, 80)}"`);
  }

  const corrections = grouped.get("correction");
  if (corrections && corrections.length > 0) {
    lines.push("");
    lines.push("**Action**: Recent corrections detected. Question assumptions BEFORE responding, not after correction.");
  }

  return lines.join("\n");
}

export async function assembleSoulContext(config: SoulConfig): Promise<string> {
  const [soulMd, correctionsMd, stateMd, storyMd, shadowRaw] =
    await Promise.all([
      readFileSafe(soulFilePath("SOUL.md")),
      readFileSafe(soulFilePath("CORRECTIONS.md")),
      readFileSafe(soulFilePath("STATE.md")),
      readFileSafe(soulFilePath("STORY.md")),
      readFileSafe(soulFilePath("SHADOW.md")),
    ]);

  const frameworkEngine = new FrameworkEngine();
  const store = await frameworkEngine.initialize();
  const frameworksMd = renderFrameworksToMarkdown(store);

  const shadowTransformed = transformShadowContent(shadowRaw);

  const exemplars = await readJsonSafe<Exemplar[]>(EXEMPLARS_PATH, []);
  const lessons = await readJsonSafe<Lesson[]>(LESSONS_PATH, []);
  const tensions = await readJsonSafe<TensionState>(TENSIONS_PATH, { tensions: [] });
  // B-contract (issue #6): filter to signals not yet consumed by quick
  // reflection, so already-absorbed evidence doesn't re-surface in context
  // and re-prime the same Recent Patterns warnings on every session start.
  const recentSignals = await readUnconsumed("quick");

  const blocks: ContentBlock[] = [];

  // --- TIER 1: Always included ---
  const frameworkVocabulary = renderFrameworkVocabulary(store);
  if (frameworkVocabulary.trim()) {
    blocks.push({ content: frameworkVocabulary, tier: 1, label: "Framework Vocabulary" });
  }

  const processFrameworks = renderProcessFrameworks(store);
  if (processFrameworks.trim()) {
    blocks.push({ content: processFrameworks, tier: 1, label: "Cognitive Processes" });
  }

  const recentPatterns = renderRecentSignals(recentSignals.slice(-20));
  if (recentPatterns.trim()) {
    blocks.push({ content: recentPatterns, tier: 1, label: "Recent Patterns" });
  }

  if (soulMd.trim()) {
    blocks.push({ content: soulMd, tier: 1, label: "SOUL.md" });
  }
  if (correctionsMd.trim()) {
    blocks.push({ content: correctionsMd, tier: 1, label: "CORRECTIONS.md" });
  }
  if (shadowTransformed.trim()) {
    blocks.push({ content: shadowTransformed, tier: 1, label: "SHADOW.md" });
  }
  if (stateMd.trim()) {
    blocks.push({ content: stateMd, tier: 1, label: "STATE.md" });
  }

  // --- TIER 2: Included if budget allows ---
  const compressedFrameworks = renderFrameworksCompressed(store);
  if (frameworksMd.trim()) {
    blocks.push({
      content: frameworksMd,
      tier: 2,
      label: "FRAMEWORKS.md",
      fallback: compressedFrameworks,
    });
  }

  const topLessons = selectTopLessons(lessons, config.lessons.maxInjectCount);

  if (topLessons.length > 0) {
    const lessonsContent =
      "## Active Lessons\n\n" +
      topLessons
        .map((l) => `- **${l.context}**: ${l.lesson} (confidence: ${l.confidence.toFixed(2)})`)
        .join("\n");
    blocks.push({ content: lessonsContent, tier: 2, label: "Lessons" });
  }

  const topExemplars = exemplars.slice(-config.exemplars.maxInjectCount);
  if (topExemplars.length > 0) {
    const exemplarsContent =
      "## Exemplars (what good looks like)\n\n" +
      topExemplars
        .map(
          (e) =>
            `**Context**: ${e.context}\n**Response**: ${e.responseExcerpt}\n*Frameworks active: ${e.frameworksActive.join(", ")}*`,
        )
        .join("\n\n");
    blocks.push({ content: exemplarsContent, tier: 2, label: "Exemplars" });
  }

  if (tensions.tensions.length > 0) {
    const activeTensions = tensions.tensions.filter(
      (t) => t.status === "detected" || t.status === "holding",
    );
    if (activeTensions.length > 0) {
      const tensionContent =
        "## Active Tensions\n\n" +
        activeTensions
          .map((t) => {
            const prefs = Object.entries(t.preferredInContext)
              .map(([ctx, p]) => `  - In ${ctx}: prefer ${p.preferred} (${p.confirmedCount} confirmed)`)
              .join("\n");
            return `- ${t.description}${prefs ? "\n" + prefs : ""}`;
          })
          .join("\n");
      blocks.push({ content: tensionContent, tier: 2, label: "Tensions" });
    }
  }

  // --- TIER 3: Supplementary ---
  if (storyMd.trim()) {
    blocks.push({ content: storyMd, tier: 3, label: "STORY.md" });
  }

  return applyTokenBudget(blocks, config.contextBudget.maxTokens);
}

export async function assembleSlimContext(): Promise<string> {
  const soulMd = await readFileSafe(soulFilePath("SOUL.md"));
  return soulMd;
}
