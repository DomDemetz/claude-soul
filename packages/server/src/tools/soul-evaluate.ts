import crypto from "node:crypto";
import type { MicroSignal } from "../types/learning-types.js";
import { appendSignals } from "../engine/signal-store.js";
import { FrameworkEngine } from "../engine/framework-engine.js";
import { loadConfig } from "../util/files.js";

/**
 * Self-evaluation: Claude describes its response dynamics,
 * and we generate self-signals weighted at 0.5x user signals.
 *
 * Gallwey-style: descriptive, not evaluative.
 * "Response used 450 words for a simple question" not "bad response"
 */
export async function handleSoulEvaluate(
  summary: string,
): Promise<string> {
  const config = await loadConfig();
  if (!config.selfEvaluation.enabled) {
    return "Self-evaluation is disabled in config.";
  }

  const frameworkEngine = new FrameworkEngine();
  const store = await frameworkEngine.initialize();
  const activeFrameworks = store.frameworks.filter(
    (f) => f.status === "active" || f.status === "questioning",
  );

  // Generate self-signals from the summary
  const selfSignals: MicroSignal[] = [];
  const sessionKey = crypto.randomUUID().slice(0, 8);
  const selfWeight = config.selfEvaluation.weight; // 0.5x

  // Check for length/depth mismatch indicators
  if (/too (long|verbose|detailed|much)/i.test(summary)) {
    selfSignals.push({
      timestamp: Date.now(),
      sessionKey,
      type: "disengagement",
      evidence: `Self-eval: ${summary.slice(0, 150)}`,
      source: "self",
      confidence: 0.6 * selfWeight,
      userSnippets: [],
      assistantSnippets: [],
      consumedBy: [],
    });
  }

  if (/too (short|brief|terse)/i.test(summary)) {
    selfSignals.push({
      timestamp: Date.now(),
      sessionKey,
      type: "depth_change",
      evidence: `Self-eval: ${summary.slice(0, 150)}`,
      source: "self",
      confidence: 0.6 * selfWeight,
      userSnippets: [],
      assistantSnippets: [],
      consumedBy: [],
    });
  }

  if (/pattern.?match|generic|surface/i.test(summary)) {
    selfSignals.push({
      timestamp: Date.now(),
      sessionKey,
      type: "correction",
      evidence: `Self-eval: detected pattern-matching instead of first-principles. ${summary.slice(0, 100)}`,
      source: "self",
      confidence: 0.5 * selfWeight,
      userSnippets: [],
      assistantSnippets: [],
      consumedBy: [],
    });
  }

  if (/successful|well.?received|good fit|aligned/i.test(summary)) {
    selfSignals.push({
      timestamp: Date.now(),
      sessionKey,
      type: "success",
      evidence: `Self-eval: ${summary.slice(0, 150)}`,
      source: "self",
      confidence: 0.5 * selfWeight,
      userSnippets: [],
      assistantSnippets: [],
      consumedBy: [],
    });
  }

  // Always generate a general self-observation signal
  if (selfSignals.length === 0) {
    selfSignals.push({
      timestamp: Date.now(),
      sessionKey,
      type: "depth_change",
      evidence: `Self-eval observation: ${summary.slice(0, 150)}`,
      source: "self",
      confidence: 0.4 * selfWeight,
      userSnippets: [],
      assistantSnippets: [],
      consumedBy: [],
    });
  }

  await appendSignals(selfSignals);

  const frameworkNames = activeFrameworks.slice(0, 5).map((f) => f.name);

  return [
    `Self-evaluation recorded: ${selfSignals.length} self-signal(s) (weighted at ${selfWeight}x).`,
    `Types: ${selfSignals.map((s) => s.type).join(", ")}`,
    "",
    `Active frameworks checked against: ${frameworkNames.join(", ")}`,
    "",
    "Self-signals will be factored into the next reflection cycle.",
  ].join("\n");
}
