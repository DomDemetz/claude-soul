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
import { appendSignals, getUnconsumedCounts } from "../engine/signal-store.js";
import { StateEngine } from "../engine/state-engine.js";
import { ensureDirs, loadConfig, FRAMEWORKS_PATH } from "../util/files.js";
import { readJsonSafe } from "../util/files.js";
import { runReflection } from "../engine/reflection-runner.js";
import {
  loadMeta,
  getReflectionThresholds,
  selectReflectionTier,
} from "../engine/meta-optimizer.js";
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

    // Check if reflection is due (phase-adaptive thresholds + time-based fallback).
    // B-contract (issue #6): trigger logic now uses per-tier unconsumed counts
    // rather than raw queue size, so quick consuming signals doesn't starve deep.
    const config = await loadConfig();
    // Single snapshot: avoids two sequential reads of the JSONL with a
    // potential write between them, and halves the IO cost on hot path.
    const { quick: quickUnconsumed, deep: deepUnconsumed } = await getUnconsumedCounts();
    const meta = await loadMeta();
    const thresholds = getReflectionThresholds(meta);

    // Get last reflection time
    const store = await readJsonSafe<FrameworkStore>(FRAMEWORKS_PATH, {
      version: 1 as const, frameworks: [], meta: { totalDiscovered: 0, totalRetired: 0, totalMerged: 0, lastReflectionAt: 0, reflectionCount: 0 },
    });
    const timeSinceReflection = Date.now() - store.meta.lastReflectionAt;

    const logMsg = `[soul] ${signals.length} signal(s) extracted (${signals.map((s) => s.type).join(", ")}). Pending: quick=${quickUnconsumed}, deep=${deepUnconsumed}. Phase: ${meta.phase}. Thresholds: quick=${thresholds.quickSignals}, deep=${thresholds.deepSignals}.\n`;
    await fs.appendFile(path.join(os.tmpdir(), "soul-hook.log"), logMsg, "utf-8").catch(() => {});

    const tier = selectReflectionTier({
      quickUnconsumed,
      deepUnconsumed,
      timeSinceReflectionMs: timeSinceReflection,
      thresholds,
      enabled: config.reflection.enabled,
    });

    if (tier) {
      const tierUnconsumed = tier === "deep" ? deepUnconsumed : quickUnconsumed;
      const tierThreshold = tier === "deep" ? thresholds.deepSignals : thresholds.quickSignals;
      const reason = tierUnconsumed >= tierThreshold
        ? `${tierUnconsumed} unconsumed-${tier} signals >= ${tierThreshold} threshold`
        : `time-based: ${Math.round(timeSinceReflection / 60000)}min since last reflection`;

      const reflectLog = `[soul] Triggering ${tier} reflection (${reason}). Phase: ${meta.phase}.\n`;
      await fs.appendFile(path.join(os.tmpdir(), "soul-hook.log"), reflectLog, "utf-8").catch(() => {});

      // Lock file prevents concurrent reflections from parallel sessions.
      // On first failure we check whether the owning PID is still alive —
      // if not, the lock is stale (left by a crashed process) and we steal it.
      const lockPath = path.join(os.tmpdir(), "soul-reflect.lock");
      async function tryAcquireLock(): Promise<boolean> {
        // Optimistic path: exclusive create succeeds immediately.
        const direct = await fs.writeFile(lockPath, String(process.pid), { flag: "wx" })
          .then(() => true).catch(() => false);
        if (direct) return true;

        // Failed — read the PID that holds the lock.
        const ownerPid = parseInt(await fs.readFile(lockPath, "utf-8").catch(() => ""), 10);
        if (!Number.isFinite(ownerPid)) return false; // unreadable/corrupt — don't steal

        // Check whether the owning process is still running.
        const ownerAlive = await new Promise<boolean>((resolve) => {
          try { process.kill(ownerPid, 0); resolve(true); }
          catch (e: any) { resolve(e.code !== "ESRCH"); } // ESRCH = no such process
        });
        if (ownerAlive) return false;

        // Stale lock — delete and retry once.
        await fs.unlink(lockPath).catch(() => {});
        return fs.writeFile(lockPath, String(process.pid), { flag: "wx" })
          .then(() => true).catch(() => false);
      }

      const lockAcquired = await tryAcquireLock();

      if (!lockAcquired) {
        await fs.appendFile(path.join(os.tmpdir(), "soul-hook.log"), `[soul] Reflection skipped — lock held by another process.\n`, "utf-8").catch(() => {});
      } else {
        try {
          const result = await runReflection(tier);
          const resultLog = `[soul] ${tier} reflection complete: ${result.frameworksUpdated} updated, ${result.newFrameworks} new, ${result.retired} retired, ${result.lessonsGenerated} lessons.\n`;
          await fs.appendFile(path.join(os.tmpdir(), "soul-hook.log"), resultLog, "utf-8").catch(() => {});
        } catch (reflectErr) {
          const errLog = `[soul] ${tier} reflection failed: ${reflectErr}\n`;
          await fs.appendFile(path.join(os.tmpdir(), "soul-hook.log"), errLog, "utf-8").catch(() => {});
        } finally {
          await fs.unlink(lockPath).catch(() => {});
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
