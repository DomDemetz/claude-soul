import { describe, it, expect } from "vitest";
import type { MicroSignal } from "../src/types/learning-types.js";
import {
  filterUnconsumedByTier,
  markBatchConsumed,
  isFullyConsumedByAllTiers,
  dropFullyConsumed,
  type ReflectionTier,
} from "../src/engine/signal-store.js";

const ALL_TIERS: ReflectionTier[] = ["quick", "deep"];

function makeSignal(overrides: Partial<MicroSignal> = {}): MicroSignal {
  return {
    timestamp: 1_700_000_000_000,
    sessionKey: "sess0001",
    type: "correction",
    evidence: "you said X but should be Y",
    source: "user",
    confidence: 0.8,
    userSnippets: [],
    assistantSnippets: [],
    ...overrides,
  };
}

describe("signal-store — filterUnconsumedByTier", () => {
  it("returns signals that have no consumedBy field (legacy / pre-B-contract)", () => {
    const s = makeSignal();
    const result = filterUnconsumedByTier([s], "quick");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(s);
  });

  it("returns signals whose consumedBy array lacks an entry for the requested tier", () => {
    const s = makeSignal({
      consumedBy: [{ tier: "deep", reflectionId: "ref-1", timestamp: 1 }],
    });
    expect(filterUnconsumedByTier([s], "quick")).toHaveLength(1);
    expect(filterUnconsumedByTier([s], "deep")).toHaveLength(0);
  });

  it("excludes signals already consumed by the requested tier", () => {
    const s = makeSignal({
      consumedBy: [{ tier: "quick", reflectionId: "ref-1", timestamp: 1 }],
    });
    expect(filterUnconsumedByTier([s], "quick")).toHaveLength(0);
  });

  it("returns multiple matching signals while excluding consumed ones", () => {
    const pending = makeSignal({ timestamp: 1 });
    const consumed = makeSignal({
      timestamp: 2,
      consumedBy: [{ tier: "quick", reflectionId: "ref-1", timestamp: 1 }],
    });
    const result = filterUnconsumedByTier([pending, consumed], "quick");
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(1);
  });
});

describe("signal-store — markBatchConsumed", () => {
  it("adds a consumedBy entry to signals matching the consumed batch", () => {
    const s1 = makeSignal({ timestamp: 1 });
    const s2 = makeSignal({ timestamp: 2 });
    const result = markBatchConsumed([s1, s2], [s1], "quick", "ref-1", 100);
    expect(result[0].consumedBy).toEqual([
      { tier: "quick", reflectionId: "ref-1", timestamp: 100 },
    ]);
    expect(result[1].consumedBy).toBeUndefined();
  });

  it("preserves existing consumedBy entries when adding a new one for a different tier", () => {
    const s = makeSignal({
      consumedBy: [{ tier: "quick", reflectionId: "ref-q1", timestamp: 50 }],
    });
    const result = markBatchConsumed([s], [s], "deep", "ref-d1", 100);
    expect(result[0].consumedBy).toEqual([
      { tier: "quick", reflectionId: "ref-q1", timestamp: 50 },
      { tier: "deep", reflectionId: "ref-d1", timestamp: 100 },
    ]);
  });

  it("is idempotent: re-marking the same (tier, reflectionId) does not duplicate", () => {
    const s = makeSignal({
      consumedBy: [{ tier: "quick", reflectionId: "ref-1", timestamp: 50 }],
    });
    const result = markBatchConsumed([s], [s], "quick", "ref-1", 100);
    expect(result[0].consumedBy).toHaveLength(1);
    expect(result[0].consumedBy?.[0].timestamp).toBe(50);
  });

  it("matches signals by identity tuple (timestamp + sessionKey + type + evidence), not object reference", () => {
    const stored = makeSignal({ timestamp: 1, evidence: "abc" });
    const consumedCopy = { ...stored };
    const result = markBatchConsumed([stored], [consumedCopy], "quick", "ref-1", 100);
    expect(result[0].consumedBy).toHaveLength(1);
  });

  it("preserves cross-tier independence: marking quick does not mark deep", () => {
    const s = makeSignal();
    const result = markBatchConsumed([s], [s], "quick", "ref-1", 100);
    expect(filterUnconsumedByTier(result, "deep")).toHaveLength(1);
    expect(filterUnconsumedByTier(result, "quick")).toHaveLength(0);
  });
});

describe("signal-store — isFullyConsumedByAllTiers", () => {
  it("returns true when consumedBy covers every named tier", () => {
    const s = makeSignal({
      consumedBy: [
        { tier: "quick", reflectionId: "ref-q", timestamp: 1 },
        { tier: "deep", reflectionId: "ref-d", timestamp: 2 },
      ],
    });
    expect(isFullyConsumedByAllTiers(s, ALL_TIERS)).toBe(true);
  });

  it("returns false when any named tier is missing", () => {
    const s = makeSignal({
      consumedBy: [{ tier: "quick", reflectionId: "ref-q", timestamp: 1 }],
    });
    expect(isFullyConsumedByAllTiers(s, ALL_TIERS)).toBe(false);
  });

  it("returns false for signals with no consumedBy field (legacy)", () => {
    expect(isFullyConsumedByAllTiers(makeSignal(), ALL_TIERS)).toBe(false);
  });
});

describe("signal-store — dropFullyConsumed (GC, per maintainer's in-scope requirement on issue #6)", () => {
  it("removes signals consumed by every named tier", () => {
    const fullyConsumed = makeSignal({
      timestamp: 1,
      consumedBy: [
        { tier: "quick", reflectionId: "ref-q", timestamp: 10 },
        { tier: "deep", reflectionId: "ref-d", timestamp: 20 },
      ],
    });
    expect(dropFullyConsumed([fullyConsumed], ALL_TIERS)).toEqual([]);
  });

  it("keeps signals consumed by some but not all tiers", () => {
    const halfConsumed = makeSignal({
      timestamp: 1,
      consumedBy: [{ tier: "quick", reflectionId: "ref-q", timestamp: 10 }],
    });
    const result = dropFullyConsumed([halfConsumed], ALL_TIERS);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(1);
  });

  it("keeps unconsumed (legacy) signals", () => {
    const fresh = makeSignal({ timestamp: 1 });
    expect(dropFullyConsumed([fresh], ALL_TIERS)).toEqual([fresh]);
  });

  it("preserves order of kept signals", () => {
    const a = makeSignal({ timestamp: 1 });
    const fullyConsumed = makeSignal({
      timestamp: 2,
      consumedBy: [
        { tier: "quick", reflectionId: "ref-q", timestamp: 10 },
        { tier: "deep", reflectionId: "ref-d", timestamp: 20 },
      ],
    });
    const c = makeSignal({ timestamp: 3 });
    const result = dropFullyConsumed([a, fullyConsumed, c], ALL_TIERS);
    expect(result.map((s) => s.timestamp)).toEqual([1, 3]);
  });
});
