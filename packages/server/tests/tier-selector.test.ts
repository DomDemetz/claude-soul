import { describe, it, expect } from "vitest";
import { selectReflectionTier } from "../src/engine/meta-optimizer.js";

const baseThresholds = {
  minSignals: 3,
  quickSignals: 8,
  deepSignals: 25,
  quickTimeMs: 60 * 60 * 1000, // 1h
  deepTimeMs: 12 * 60 * 60 * 1000, // 12h
};

describe("selectReflectionTier — B-contract trigger policy", () => {
  it("returns null when reflection is disabled", () => {
    const result = selectReflectionTier({
      quickUnconsumed: 100,
      deepUnconsumed: 100,
      timeSinceReflectionMs: 0,
      thresholds: baseThresholds,
      enabled: false,
    });
    expect(result).toBeNull();
  });

  it("returns null when neither tier has min signals and no time threshold met", () => {
    expect(
      selectReflectionTier({
        quickUnconsumed: 2,
        deepUnconsumed: 2,
        timeSinceReflectionMs: 0,
        thresholds: baseThresholds,
        enabled: true,
      }),
    ).toBeNull();
  });

  it("returns 'deep' when deepUnconsumed meets deepSignals threshold", () => {
    expect(
      selectReflectionTier({
        quickUnconsumed: 0,
        deepUnconsumed: 25,
        timeSinceReflectionMs: 0,
        thresholds: baseThresholds,
        enabled: true,
      }),
    ).toBe("deep");
  });

  it("returns 'deep' via time fallback when deepTimeMs elapsed and deepUnconsumed >= minSignals", () => {
    expect(
      selectReflectionTier({
        quickUnconsumed: 0,
        deepUnconsumed: 3,
        timeSinceReflectionMs: baseThresholds.deepTimeMs,
        thresholds: baseThresholds,
        enabled: true,
      }),
    ).toBe("deep");
  });

  it("returns 'quick' when quickUnconsumed meets quickSignals threshold and deep is not triggered", () => {
    expect(
      selectReflectionTier({
        quickUnconsumed: 8,
        deepUnconsumed: 0,
        timeSinceReflectionMs: 0,
        thresholds: baseThresholds,
        enabled: true,
      }),
    ).toBe("quick");
  });

  it("returns 'quick' via time fallback when quickTimeMs elapsed and quickUnconsumed >= minSignals", () => {
    expect(
      selectReflectionTier({
        quickUnconsumed: 3,
        deepUnconsumed: 0,
        timeSinceReflectionMs: baseThresholds.quickTimeMs,
        thresholds: baseThresholds,
        enabled: true,
      }),
    ).toBe("quick");
  });

  it("'deep' takes precedence over 'quick' when both tiers cross their count threshold simultaneously", () => {
    expect(
      selectReflectionTier({
        quickUnconsumed: 100,
        deepUnconsumed: 100,
        timeSinceReflectionMs: 0,
        thresholds: baseThresholds,
        enabled: true,
      }),
    ).toBe("deep");
  });

  it("ignores time fallback when the tier's unconsumed count is below minSignals (avoids low-evidence triggers)", () => {
    expect(
      selectReflectionTier({
        quickUnconsumed: 1,
        deepUnconsumed: 1,
        timeSinceReflectionMs: baseThresholds.deepTimeMs,
        thresholds: baseThresholds,
        enabled: true,
      }),
    ).toBeNull();
  });
});
