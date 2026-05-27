import fs from "node:fs/promises";
import type { MicroSignal, ConsumedByEntry } from "../types/learning-types.js";
import { SESSION_LOG_PATH, DATA_DIR } from "../util/files.js";

export type ReflectionTier = "quick" | "deep";

// Cap raised from 50KB (pre-B-contract, when clearSignals() wiped after every
// reflection) to 500KB because signals now persist across cycles per the
// per-tier consumed-tracking contract (issue #6). Deep alone needs 25/60/100
// unconsumed signals depending on phase, and signals carry user/assistant
// snippets; 50KB is too tight under active use.
const MAX_FILE_SIZE = 500 * 1024;

function signalIdentityKey(s: MicroSignal): string {
  return `${s.timestamp}|${s.sessionKey}|${s.type}|${s.evidence}`;
}

export function filterUnconsumedByTier(
  signals: MicroSignal[],
  tier: ReflectionTier,
): MicroSignal[] {
  return signals.filter((s) => {
    const entries = s.consumedBy ?? [];
    return !entries.some((e) => e.tier === tier);
  });
}

export function markBatchConsumed(
  allSignals: MicroSignal[],
  consumed: MicroSignal[],
  tier: ReflectionTier,
  reflectionId: string,
  timestamp: number,
): MicroSignal[] {
  const consumedKeys = new Set(consumed.map(signalIdentityKey));
  return allSignals.map((s) => {
    if (!consumedKeys.has(signalIdentityKey(s))) return s;
    const existing = s.consumedBy ?? [];
    const alreadyMarked = existing.some(
      (e) => e.tier === tier && e.reflectionId === reflectionId,
    );
    if (alreadyMarked) return s;
    const newEntry: ConsumedByEntry = { tier, reflectionId, timestamp };
    return { ...s, consumedBy: [...existing, newEntry] };
  });
}

export function isFullyConsumedByAllTiers(
  signal: MicroSignal,
  allTiers: ReflectionTier[],
): boolean {
  const entries = signal.consumedBy ?? [];
  const consumedTiers = new Set(entries.map((e) => e.tier));
  return allTiers.every((t) => consumedTiers.has(t));
}

export function dropFullyConsumed(
  signals: MicroSignal[],
  allTiers: ReflectionTier[],
): MicroSignal[] {
  return signals.filter((s) => !isFullyConsumedByAllTiers(s, allTiers));
}

export async function appendSignals(signals: MicroSignal[]): Promise<void> {
  if (signals.length === 0) return;

  await fs.mkdir(DATA_DIR, { recursive: true });

  const newLines = signals.map((s) => JSON.stringify(s)).join("\n") + "\n";
  await fs.appendFile(SESSION_LOG_PATH, newLines, "utf8");

  try {
    const stat = await fs.stat(SESSION_LOG_PATH);
    if (stat.size > MAX_FILE_SIZE) {
      const content = await fs.readFile(SESSION_LOG_PATH, "utf8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);

      let truncated = lines;
      while (truncated.length > 0) {
        const joined = truncated.join("\n") + "\n";
        if (Buffer.byteLength(joined, "utf8") <= MAX_FILE_SIZE) {
          await fs.writeFile(SESSION_LOG_PATH, joined, "utf8");
          break;
        }
        truncated = truncated.slice(1);
      }

      if (truncated.length === 0) {
        await fs.writeFile(SESSION_LOG_PATH, "", "utf8");
      }
    }
  } catch {
    // File doesn't exist yet, that's fine
  }
}

export async function readSignals(): Promise<MicroSignal[]> {
  try {
    const content = await fs.readFile(SESSION_LOG_PATH, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    return lines.map((l) => JSON.parse(l) as MicroSignal);
  } catch {
    return [];
  }
}

export async function readUnconsumed(
  tier: ReflectionTier,
): Promise<MicroSignal[]> {
  const all = await readSignals();
  return filterUnconsumedByTier(all, tier);
}

export async function getUnconsumedCount(
  tier: ReflectionTier,
): Promise<number> {
  return (await readUnconsumed(tier)).length;
}

async function writeAllSignals(signals: MicroSignal[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const content =
    signals.length === 0
      ? ""
      : signals.map((s) => JSON.stringify(s)).join("\n") + "\n";
  await fs.writeFile(SESSION_LOG_PATH, content, "utf8");
}

export async function markConsumed(
  consumed: MicroSignal[],
  tier: ReflectionTier,
  reflectionId: string,
): Promise<void> {
  if (consumed.length === 0) return;
  const all = await readSignals();
  const updated = markBatchConsumed(all, consumed, tier, reflectionId, Date.now());
  await writeAllSignals(updated);
}

export async function gcFullyConsumed(
  allTiers: ReflectionTier[],
): Promise<void> {
  const all = await readSignals();
  const kept = dropFullyConsumed(all, allTiers);
  if (kept.length === all.length) return;
  await writeAllSignals(kept);
}

export async function getSignalCount(): Promise<number> {
  const signals = await readSignals();
  return signals.length;
}

// Deprecated under B-contract (issue #6): signals are now consumed per-tier
// via markConsumed() + gcFullyConsumed() rather than wiped after every
// reflection. Retained as a deliberate no-op so existing callers (if any
// rebase against this branch) don't error.
export async function clearSignals(): Promise<void> {
  // intentionally a no-op
}
