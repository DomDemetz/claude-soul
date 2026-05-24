#!/usr/bin/env node

/**
 * Soul System Stop Hook
 *
 * Runs after every Claude Code conversation. Reads the transcript,
 * extracts signals, updates state, and checks if reflection is due.
 *
 * Input (stdin): JSON with session_id, transcript_path, etc.
 * Output (stdout): JSON with optional decision to block stopping.
 */

import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseTranscript, extractSignalsFromMessages } from "../engine/signal-extractor.js";
import { appendSignals, getSignalCount } from "../engine/signal-store.js";
import { StateEngine } from "../engine/state-engine.js";
import { ensureDirs, loadConfig, FRAMEWORKS_PATH } from "../util/files.js";
import { readJsonSafe } from "../util/files.js";
import { runReflection } from "../engine/reflection-runner.js";
import { loadMeta, getReflectionThresholds } from "../engine/meta-optimizer.js";
import type { FrameworkStore } from "../types/learning-types.js";

type StopHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  stop_reason?: string;
};

async function main() {
  // Read hook input from stdin
  // Use a Promise-based approach for reliable stdin reading
  const input = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", () => resolve(""));
    // If stdin is already ended (no pipe), resolve after short timeout
    setTimeout(() => resolve(Buffer.concat(chunks).toString("utf-8")), 500);
  });

  if (!input.trim()) {
    process.exit(0);
  }

  let hookInput: StopHookInput;
  try {
    hookInput = JSON.parse(input);
  } catch {
    // Not valid JSON, exit silently
    process.exit(0);
  }

  if (!hookInput.transcript_path) {
    process.exit(0);
  }

  try {
    await ensureDirs();

    // Read the transcript
    let transcriptContent: string;
    try {
      transcriptContent = await fs.readFile(hookInput.transcript_path, "utf-8");
    } catch {
      // Transcript file doesn't exist or can't be read
      process.exit(0);
    }

    if (!transcriptContent.trim()) {
      process.exit(0);
    }

    // Parse transcript into messages
    const messages = parseTranscript(transcriptContent);

    if (messages.length < 2) {
      // Need at least one user and one assistant message
      process.exit(0);
    }

    // Extract signals using regex heuristics
    const sessionKey = hookInput.session_id?.slice(0, 8) ?? "unknown";
    const signals = extractSignalsFromMessages(messages, sessionKey);

    if (signals.length === 0) {
      process.exit(0);
    }

    // Store signals
    await appendSignals(signals);

    // Update state engine based on signals
    const stateEngine = new StateEngine();
    await stateEngine.load();

    for (const signal of signals) {
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
        case "disengagement":
          stateEngine.recordEvent({ type: "negative_interaction", delta: 0.03 });
          break;
      }
    }

    await stateEngine.tick();

    // Check if reflection is due (phase-adaptive thresholds + time-based fallback)
    const config = await loadConfig();
    const totalSignals = await getSignalCount();
    const meta = await loadMeta();
    const thresholds = getReflectionThresholds(meta);

    // Get last reflection time
    const store = await readJsonSafe<FrameworkStore>(FRAMEWORKS_PATH, {
      version: 1 as const, frameworks: [], meta: { totalDiscovered: 0, totalRetired: 0, totalMerged: 0, lastReflectionAt: 0, reflectionCount: 0 },
    });
    const timeSinceReflection = Date.now() - store.meta.lastReflectionAt;

    // Log signal extraction
    const logMsg = `[soul] ${signals.length} signal(s) extracted (${signals.map((s) => s.type).join(", ")}). Total: ${totalSignals}. Phase: ${meta.phase}. Thresholds: quick=${thresholds.quickSignals}, deep=${thresholds.deepSignals}.\n`;
    await fs.appendFile(path.join(os.tmpdir(), "soul-hook.log"), logMsg, "utf-8").catch(() => {});

    if (!config.reflection.enabled || totalSignals < thresholds.minSignals) {
      // Not enough signals for any reflection
    } else {
      // Determine which tier to run
      let tier: "quick" | "deep" | null = null;

      // Deep reflection: signal threshold OR time threshold
      if (
        totalSignals >= thresholds.deepSignals ||
        (timeSinceReflection >= thresholds.deepTimeMs && totalSignals >= thresholds.minSignals)
      ) {
        tier = "deep";
      }
      // Quick reflection: signal threshold OR time threshold
      else if (
        totalSignals >= thresholds.quickSignals ||
        (timeSinceReflection >= thresholds.quickTimeMs && totalSignals >= thresholds.minSignals)
      ) {
        tier = "quick";
      }

      if (tier) {
        const reason = totalSignals >= (tier === "deep" ? thresholds.deepSignals : thresholds.quickSignals)
          ? `${totalSignals} signals >= ${tier === "deep" ? thresholds.deepSignals : thresholds.quickSignals} threshold`
          : `time-based: ${Math.round(timeSinceReflection / 60000)}min since last reflection`;

        const reflectLog = `[soul] Triggering ${tier} reflection (${reason}). Phase: ${meta.phase}.\n`;
        await fs.appendFile(path.join(os.tmpdir(), "soul-hook.log"), reflectLog, "utf-8").catch(() => {});

        try {
          const result = await runReflection(tier);
          const resultLog = `[soul] ${tier} reflection complete: ${result.frameworksUpdated} updated, ${result.newFrameworks} new, ${result.retired} retired, ${result.lessonsGenerated} lessons.\n`;
          await fs.appendFile(path.join(os.tmpdir(), "soul-hook.log"), resultLog, "utf-8").catch(() => {});
        } catch (reflectErr) {
          const errLog = `[soul] ${tier} reflection failed: ${reflectErr}\n`;
          await fs.appendFile(path.join(os.tmpdir(), "soul-hook.log"), errLog, "utf-8").catch(() => {});
        }
      }
    }
  } catch (err) {
    // Log errors but don't crash — hooks should be resilient
    const errMsg = `[soul] Stop hook error: ${err}\n`;
    await fs.appendFile(path.join(os.tmpdir(), "soul-hook.log"), errMsg, "utf-8").catch(() => {});
  }

  process.exit(0);
}

main();
