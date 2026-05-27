import fs from "node:fs/promises";
import type {
  MicroSignal,
  ConsumedByEntry,
  ReflectionTier,
} from "../types/learning-types.js";
import { SESSION_LOG_PATH, DATA_DIR } from "../util/files.js";

// Re-export so consumers that already use signal-store don't need a second
// import path; ReflectionTier itself lives in learning-types because tier is
// a domain concept, not a store implementation detail.
export type { ReflectionTier } from "../types/learning-types.js";

export const ALL_REFLECTION_TIERS: ReflectionTier[] = ["quick", "deep"];

// Cap raised from 50KB (pre-B-contract, when clearSignals() wiped after every
// reflection) to 500KB because signals now persist across cycles per the
// per-tier consumed-tracking contract (issue #6). Deep alone needs 25/60/100
// unconsumed signals depending on phase, and signals carry user/assistant
// snippets; 50KB is too tight under active use.
const MAX_FILE_SIZE = 500 * 1024;

// JSON.stringify of an ordered tuple gives a non-ambiguous encoding regardless
// of whether any field contains a delimiter character. Cheaper than per-field
// escaping and the cost is a few extra bytes per key.
function signalIdentityKey(s: MicroSignal): string {
  return JSON.stringify([s.timestamp, s.sessionKey, s.type, s.evidence]);
}

export function filterUnconsumedByTier(
  signals: MicroSignal[],
  tier: ReflectionTier,
): MicroSignal[] {
  return signals.filter((s) => !s.consumedBy.some((e) => e.tier === tier));
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
    // Per-tier consumption is binary: once a tier has credited a signal it
    // shouldn't credit it again, regardless of which reflectionId is asking.
    // Key the idempotency check on tier alone, not on (tier, reflectionId).
    if (s.consumedBy.some((e) => e.tier === tier)) return s;
    const newEntry: ConsumedByEntry = { tier, reflectionId, timestamp };
    return { ...s, consumedBy: [...s.consumedBy, newEntry] };
  });
}

export function isFullyConsumedByAllTiers(
  signal: MicroSignal,
  allTiers: ReflectionTier[],
): boolean {
  return allTiers.every((t) => signal.consumedBy.some((e) => e.tier === t));
}

export function dropFullyConsumed(
  signals: MicroSignal[],
  allTiers: ReflectionTier[],
): MicroSignal[] {
  return signals.filter((s) => !isFullyConsumedByAllTiers(s, allTiers));
}

export function countPendingByTier(lines: string[]): {
  total: number;
  pendingQuick: number;
  pendingDeep: number;
  corrections: number;
} {
  let pendingQuick = 0;
  let pendingDeep = 0;
  let corrections = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        consumedBy?: Array<{ tier: string }>;
      };
      const tiers = new Set((parsed.consumedBy ?? []).map((c) => c.tier));
      if (!tiers.has("quick")) pendingQuick++;
      if (!tiers.has("deep")) pendingDeep++;
      if (parsed.type === "correction") corrections++;
    } catch {
      // Conservative: a malformed line is opaque, count it as pending for
      // both tiers so triggers don't silently miss real evidence.
      pendingQuick++;
      pendingDeep++;
    }
  }
  return { total: lines.length, pendingQuick, pendingDeep, corrections };
}

export async function appendSignals(signals: MicroSignal[]): Promise<void> {
  if (signals.length === 0) return;

  await fs.mkdir(DATA_DIR, { recursive: true });

  // Normalize consumedBy on construction so writers don't need to remember
  // (matches the type-enforced invariant in MicroSignal).
  const normalized = signals.map((s) => ({ ...s, consumedBy: s.consumedBy ?? [] }));
  const newLines = normalized.map((s) => JSON.stringify(s)).join("\n") + "\n";
  await fs.appendFile(SESSION_LOG_PATH, newLines, "utf8");

  try {
    const stat = await fs.stat(SESSION_LOG_PATH);
    if (stat.size <= MAX_FILE_SIZE) return;

    // GC fully-consumed signals before falling back to oldest-first slice.
    // Pre-#6 the unconditional clearSignals() wipe meant any signal that
    // survived to truncation was unconsumed; under B-contract signals persist
    // and the front-slice would drop the oldest still-pending evidence,
    // structurally preventing a tier from ever reaching its threshold. GC
    // first reaps everything already consumed by both tiers (cheap, safe),
    // and only if still over MAX_FILE_SIZE do we fall back to the slice.
    await gcFullyConsumed(ALL_REFLECTION_TIERS);

    const stat2 = await fs.stat(SESSION_LOG_PATH);
    if (stat2.size <= MAX_FILE_SIZE) return;

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
  } catch (err) {
    // ENOENT here means the file vanished between the append and the stat —
    // benign. Anything else (EACCES / EISDIR / EMFILE) is operational and
    // should propagate so the user sees the real problem.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw err;
  }
}

export async function readSignals(): Promise<MicroSignal[]> {
  let content: string;
  try {
    content = await fs.readFile(SESSION_LOG_PATH, "utf8");
  } catch (err) {
    // ENOENT means "no signals recorded yet" — return empty. Any other error
    // (EACCES, EISDIR, etc.) is an operational problem the caller should see;
    // silently returning [] from here would cause markConsumed/gcFullyConsumed
    // to write [] back, destroying real on-disk data.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const result: MicroSignal[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as MicroSignal;
      // Honor the required-with-default invariant on consumedBy: legacy
      // session logs (pre-#6) don't carry the field. Normalize on read so
      // downstream callers can rely on the type.
      result.push({ ...parsed, consumedBy: parsed.consumedBy ?? [] });
    } catch {
      // Skip the bad line but keep the rest. Pre-#6 a single bad line dropped
      // the whole queue via the outer bare catch; under B-contract that would
      // cascade into a destructive write through markConsumed.
    }
  }
  return result;
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

// Single-snapshot variant of getUnconsumedCount that returns both tiers from
// one disk read. Callers that need both counts (e.g. on-stop's trigger
// decision) get a consistent view AND avoid double-reading the session log.
export async function getUnconsumedCounts(): Promise<{
  quick: number;
  deep: number;
}> {
  const all = await readSignals();
  return {
    quick: filterUnconsumedByTier(all, "quick").length,
    deep: filterUnconsumedByTier(all, "deep").length,
  };
}

// Removed under B-contract (issue #6): signals are now consumed per-tier via
// markConsumed() + gcFullyConsumed(). A silent no-op here would let any
// remaining caller think the queue had been wiped when in fact the data
// stayed put — a contract violation that's harder to debug than a loud throw.
export async function clearSignals(): Promise<never> {
  throw new Error(
    "[soul] clearSignals() was removed by the B-contract (issue #6). " +
      "Use markConsumed(signals, tier, reflectionId) + " +
      "gcFullyConsumed(ALL_REFLECTION_TIERS) instead.",
  );
}
