import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FrameworkEngine } from "../src/engine/framework-engine.js";
import type { Framework, FrameworkEvidence, EvidenceTier } from "../src/types/learning-types.js";

const TEST_DIR = path.join(os.tmpdir(), "claude-soul-test-" + process.pid);
const DATA_DIR = path.join(TEST_DIR, "data");

// Override the framework path for testing
const FRAMEWORKS_PATH = path.join(DATA_DIR, "frameworks.json");

// We need to mock the file paths. Since FrameworkEngine uses FRAMEWORKS_PATH from util/files,
// we'll test the pure logic methods directly and use a real temp directory for integration tests.

describe("FrameworkEngine — pure logic", () => {
  let engine: FrameworkEngine;

  beforeEach(() => {
    engine = new FrameworkEngine();
  });

  describe("calculateConfidence", () => {
    function makeFramework(evidence: FrameworkEvidence[], applicationCount = 5): Framework {
      return {
        id: "fw-test",
        name: "Test Framework",
        description: "test",
        domain: "epistemic",
        kind: "mental-model",
        confidence: 0.5,
        evidenceTier: "hypothesis",
        source: "seed",
        evidence,
        relatedFrameworks: [],
        contradicts: [],
        supersedes: [],
        workflows: [],
        createdAt: Date.now(),
        lastTestedAt: Date.now(),
        applicationCount,
        version: 1,
        status: "questioning",
      };
    }

    it("returns 0 for framework with no evidence and zero usage", () => {
      const fw = makeFramework([], 0);
      expect(engine.calculateConfidence(fw)).toBe(0);
    });

    it("increases confidence with confirmed evidence", () => {
      const now = Date.now();
      const evidence: FrameworkEvidence[] = [
        { timestamp: now, type: "confirmed", context: "worked well" },
        { timestamp: now, type: "confirmed", context: "applied successfully" },
        { timestamp: now, type: "confirmed", context: "third confirmation" },
      ];
      const fw = makeFramework(evidence);
      const conf = engine.calculateConfidence(fw);
      expect(conf).toBeGreaterThan(0.5);
    });

    it("decreases confidence with contradicted evidence", () => {
      const now = Date.now();
      const evidence: FrameworkEvidence[] = [
        { timestamp: now, type: "contradicted", context: "didn't work" },
        { timestamp: now, type: "contradicted", context: "failed again" },
        { timestamp: now, type: "contradicted", context: "third failure" },
      ];
      const fw = makeFramework(evidence);
      const conf = engine.calculateConfidence(fw);
      expect(conf).toBe(0);
    });

    it("weights recent evidence more heavily (2x within 7 days)", () => {
      const now = Date.now();
      const oldDate = now - 14 * 24 * 60 * 60 * 1000; // 14 days ago

      const recentEvidence: FrameworkEvidence[] = [
        { timestamp: now, type: "confirmed", context: "recent" },
      ];
      const oldEvidence: FrameworkEvidence[] = [
        { timestamp: oldDate, type: "confirmed", context: "old" },
      ];

      const fwRecent = makeFramework(recentEvidence);
      const fwOld = makeFramework(oldEvidence);

      expect(engine.calculateConfidence(fwRecent)).toBeGreaterThan(
        engine.calculateConfidence(fwOld),
      );
    });

    it("weights self-referential evidence at half (0.5x)", () => {
      const now = Date.now();

      const externalEvidence: FrameworkEvidence[] = [
        { timestamp: now, type: "confirmed", context: "external confirmation", contextType: "external" },
      ];
      const selfRefEvidence: FrameworkEvidence[] = [
        { timestamp: now, type: "confirmed", context: "soul system meta", contextType: "self-referential" },
      ];

      const fwExternal = makeFramework(externalEvidence);
      const fwSelfRef = makeFramework(selfRefEvidence);

      expect(engine.calculateConfidence(fwExternal)).toBeGreaterThan(
        engine.calculateConfidence(fwSelfRef),
      );
    });

    it("scales confidence by usage (min 1, applicationCount/5)", () => {
      const now = Date.now();
      const evidence: FrameworkEvidence[] = [
        { timestamp: now, type: "confirmed", context: "yes" },
      ];

      const fwLowUsage = makeFramework(evidence, 1);
      const fwHighUsage = makeFramework(evidence, 10);

      expect(engine.calculateConfidence(fwHighUsage)).toBeGreaterThan(
        engine.calculateConfidence(fwLowUsage),
      );
    });

    it("clamps confidence between 0 and 1", () => {
      const now = Date.now();
      const manyConfirmed: FrameworkEvidence[] = Array.from({ length: 50 }, () => ({
        timestamp: now,
        type: "confirmed" as const,
        context: "yes",
        contextType: "external" as const,
      }));
      const fw = makeFramework(manyConfirmed, 100);
      const conf = engine.calculateConfidence(fw);
      expect(conf).toBeLessThanOrEqual(1);
      expect(conf).toBeGreaterThanOrEqual(0);
    });
  });

  describe("calculateTier", () => {
    function makeFramework(evidence: FrameworkEvidence[], currentTier: EvidenceTier = "hypothesis"): Framework {
      return {
        id: "fw-test",
        name: "Test",
        description: "test",
        domain: "general",
        kind: "mental-model",
        confidence: 0.5,
        evidenceTier: currentTier,
        source: "seed",
        evidence,
        relatedFrameworks: [],
        contradicts: [],
        supersedes: [],
        workflows: [],
        createdAt: Date.now(),
        lastTestedAt: Date.now(),
        applicationCount: 0,
        version: 1,
        status: "questioning",
      };
    }

    it("returns hypothesis with no external evidence", () => {
      const fw = makeFramework([]);
      expect(engine.calculateTier(fw)).toBe("hypothesis");
    });

    it("promotes to observed with 1 external confirmed", () => {
      const fw = makeFramework([
        { timestamp: Date.now(), type: "confirmed", context: "user said it worked", contextType: "external" },
      ]);
      expect(engine.calculateTier(fw)).toBe("observed");
    });

    it("promotes to validated with 3+ external confirmed", () => {
      const evidence: FrameworkEvidence[] = [
        { timestamp: Date.now(), type: "confirmed", context: "first", contextType: "external" },
        { timestamp: Date.now(), type: "confirmed", context: "second", contextType: "external" },
        { timestamp: Date.now(), type: "confirmed", context: "third", contextType: "external" },
      ];
      const fw = makeFramework(evidence);
      expect(engine.calculateTier(fw)).toBe("validated");
    });

    it("does not count self-referential evidence for tier advancement", () => {
      const evidence: FrameworkEvidence[] = [
        { timestamp: Date.now(), type: "confirmed", context: "meta-reflection about soul system", contextType: "self-referential" },
        { timestamp: Date.now(), type: "confirmed", context: "another soul audit", contextType: "self-referential" },
        { timestamp: Date.now(), type: "confirmed", context: "reflection worked", contextType: "self-referential" },
      ];
      const fw = makeFramework(evidence);
      expect(engine.calculateTier(fw)).toBe("hypothesis");
    });

    it("tiers never go down (monotonic advancement)", () => {
      const fw = makeFramework([], "observed");
      expect(engine.calculateTier(fw)).toBe("observed");
    });
  });

  describe("recalculateStatus", () => {
    function makeFramework(overrides: Partial<Framework> = {}): Framework {
      return {
        id: "fw-test",
        name: "Test",
        description: "test",
        domain: "general",
        kind: "mental-model",
        confidence: 0.5,
        evidenceTier: "hypothesis",
        source: "seed",
        evidence: [],
        relatedFrameworks: [],
        contradicts: [],
        supersedes: [],
        workflows: [],
        createdAt: Date.now(),
        lastTestedAt: Date.now(),
        applicationCount: 0,
        version: 1,
        status: "questioning",
        ...overrides,
      };
    }

    it("promotes questioning → active when observed + confidence >= 0.5", () => {
      const fw = makeFramework({ evidenceTier: "observed", confidence: 0.6, status: "questioning" });
      engine.recalculateStatus(fw);
      expect(fw.status).toBe("active");
    });

    it("does not promote with hypothesis tier even with high confidence", () => {
      const fw = makeFramework({ evidenceTier: "hypothesis", confidence: 0.9, status: "questioning" });
      engine.recalculateStatus(fw);
      expect(fw.status).toBe("questioning");
    });

    it("demotes active → questioning when confidence < 0.3 with 5+ evidence", () => {
      const evidence: FrameworkEvidence[] = Array.from({ length: 5 }, () => ({
        timestamp: Date.now(),
        type: "contradicted" as const,
        context: "failed",
      }));
      const fw = makeFramework({ confidence: 0.2, status: "active", evidence });
      engine.recalculateStatus(fw);
      expect(fw.status).toBe("questioning");
    });

    it("auto-retires when confidence < 0.2 with 10+ evidence", () => {
      const evidence: FrameworkEvidence[] = Array.from({ length: 10 }, () => ({
        timestamp: Date.now(),
        type: "contradicted" as const,
        context: "failed",
      }));
      const fw = makeFramework({ confidence: 0.1, status: "active", evidence });
      engine.recalculateStatus(fw);
      expect(fw.status).toBe("retired");
    });

    it("does not modify retired frameworks", () => {
      const fw = makeFramework({ status: "retired", confidence: 0.9, evidenceTier: "validated" });
      engine.recalculateStatus(fw);
      expect(fw.status).toBe("retired");
    });

    it("does not modify merged frameworks", () => {
      const fw = makeFramework({ status: "merged", confidence: 0.9, evidenceTier: "validated" });
      engine.recalculateStatus(fw);
      expect(fw.status).toBe("merged");
    });
  });
});

describe("FrameworkEngine — framework seeds", () => {
  it("initializes with 12 seed frameworks", async () => {
    // We can't easily test initialize() without mocking fs,
    // but we can verify the seeds array directly
    const { FRAMEWORK_SEEDS } = await import("../src/engine/framework-seeds.js");
    expect(FRAMEWORK_SEEDS).toHaveLength(12);
  });

  it("all seeds have required fields", async () => {
    const { FRAMEWORK_SEEDS } = await import("../src/engine/framework-seeds.js");
    for (const seed of FRAMEWORK_SEEDS) {
      expect(seed.name).toBeTruthy();
      expect(seed.description).toBeTruthy();
      expect(seed.domain).toBeTruthy();
      expect(seed.kind).toBeTruthy();
      expect(seed.source).toBe("seed");
      expect(seed.confidence).toBeGreaterThanOrEqual(0);
      expect(seed.confidence).toBeLessThanOrEqual(1);
      expect(seed.workflows).toEqual([]);
    }
  });

  it("seeds cover all three domains", async () => {
    const { FRAMEWORK_SEEDS } = await import("../src/engine/framework-seeds.js");
    const domains = new Set(FRAMEWORK_SEEDS.map((s) => s.domain));
    expect(domains.has("cognitive-process")).toBe(true);
    expect(domains.has("epistemic")).toBe(true);
    expect(domains.has("development")).toBe(true);
  });

  it("seeds have unique names", async () => {
    const { FRAMEWORK_SEEDS } = await import("../src/engine/framework-seeds.js");
    const names = FRAMEWORK_SEEDS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
