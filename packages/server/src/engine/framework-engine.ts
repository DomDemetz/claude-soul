import crypto from "node:crypto";
import type {
  Framework,
  FrameworkStore,
  FrameworkEvidence,
  EvidenceTier,
} from "../types/learning-types.js";
import { FRAMEWORK_SEEDS } from "./framework-seeds.js";
import { FRAMEWORKS_PATH } from "../util/files.js";
import { readJsonSafe, writeJsonAtomic } from "../util/files.js";

function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

const EMPTY_STORE: FrameworkStore = {
  version: 1,
  frameworks: [],
  meta: {
    totalDiscovered: 0,
    totalRetired: 0,
    totalMerged: 0,
    lastReflectionAt: 0,
    reflectionCount: 0,
  },
};

export class FrameworkEngine {
  private store: FrameworkStore | null = null;

  async initialize(): Promise<FrameworkStore> {
    try {
      const existing = await readJsonSafe<FrameworkStore | null>(FRAMEWORKS_PATH, null);
      if (existing && existing.frameworks && existing.frameworks.length > 0) {
        let changed = this.migrateV2(existing);
        changed = this.migrateV3(existing) || changed;
        changed = this.injectMissingSeeds(existing) || changed;
        if (changed) {
          await writeJsonAtomic(FRAMEWORKS_PATH, existing);
        }
        this.store = existing;
        return existing;
      }
    } catch {
      // Fall through to create new store
    }

    const now = Date.now();
    const frameworks: Framework[] = FRAMEWORK_SEEDS.map((seed) => ({
      ...seed,
      id: generateId("fw"),
      createdAt: now,
      lastTestedAt: now,
      evidence: [],
      evidenceTier: "hypothesis" as EvidenceTier,
      relatedFrameworks: [...seed.relatedFrameworks],
      contradicts: [...seed.contradicts],
      supersedes: [...seed.supersedes],
      workflows: [],
    }));

    const store: FrameworkStore = {
      version: 1,
      schemaVersion: 3,
      frameworks,
      meta: {
        totalDiscovered: 0,
        totalRetired: 0,
        totalMerged: 0,
        lastReflectionAt: 0,
        reflectionCount: 0,
      },
    };

    await this.saveStore(store);
    return store;
  }

  async loadStore(): Promise<FrameworkStore> {
    const store = await readJsonSafe<FrameworkStore>(FRAMEWORKS_PATH, EMPTY_STORE);
    let changed = this.migrateV2(store);
    changed = this.migrateV3(store) || changed;
    changed = this.injectMissingSeeds(store) || changed;
    if (changed) {
      await writeJsonAtomic(FRAMEWORKS_PATH, store);
    }
    this.store = store;
    return store;
  }

  async saveStore(store: FrameworkStore): Promise<void> {
    await writeJsonAtomic(FRAMEWORKS_PATH, store);
    this.store = store;
  }

  async addDiscoveredFramework(partial: {
    name: string;
    description: string;
    domain: string;
    confidence: number;
  }): Promise<Framework> {
    const store = this.store ?? (await this.loadStore());
    const now = Date.now();

    const framework: Framework = {
      id: generateId("fw"),
      name: partial.name,
      description: partial.description,
      domain: partial.domain,
      kind: partial.domain === "cognitive-process" ? "process" : "mental-model",
      confidence: partial.confidence,
      evidenceTier: "hypothesis",
      source: "discovered",
      evidence: [],
      relatedFrameworks: [],
      contradicts: [],
      supersedes: [],
      workflows: [],
      createdAt: now,
      lastTestedAt: now,
      applicationCount: 0,
      version: 1,
      status: "questioning",
    };

    store.frameworks.push(framework);
    store.meta.totalDiscovered++;
    await this.saveStore(store);
    return framework;
  }

  async evolveFramework(
    id: string,
    changes: {
      description?: string;
      confidence?: number;
      status?: Framework["status"];
    },
  ): Promise<void> {
    const store = this.store ?? (await this.loadStore());
    const fw = store.frameworks.find((f) => f.id === id);
    if (!fw) return;

    if (changes.description !== undefined) fw.description = changes.description;
    if (changes.confidence !== undefined) fw.confidence = changes.confidence;
    if (changes.status !== undefined) fw.status = changes.status;
    fw.version++;

    await this.saveStore(store);
  }

  async mergeFrameworks(
    ids: string[],
    merged: { name: string; description: string },
  ): Promise<void> {
    const store = this.store ?? (await this.loadStore());
    const now = Date.now();

    const sourceFw = store.frameworks.find((f) => f.id === ids[0]);
    const mergedFw: Framework = {
      id: generateId("fw"),
      name: merged.name,
      description: merged.description,
      domain: sourceFw?.domain ?? "general",
      kind: sourceFw?.kind ?? "mental-model",
      confidence: 0.5,
      evidenceTier: "hypothesis",
      source: "merged",
      evidence: [],
      relatedFrameworks: [],
      contradicts: [],
      supersedes: ids,
      workflows: [],
      createdAt: now,
      lastTestedAt: now,
      applicationCount: 0,
      version: 1,
      status: "questioning",
    };

    store.frameworks.push(mergedFw);

    for (const id of ids) {
      const fw = store.frameworks.find((f) => f.id === id);
      if (fw) fw.status = "merged";
    }

    store.meta.totalMerged += ids.length;
    await this.saveStore(store);
  }

  async retireFramework(id: string, reason: string): Promise<void> {
    const store = this.store ?? (await this.loadStore());
    const fw = store.frameworks.find((f) => f.id === id);
    if (!fw) return;

    fw.status = "retired";
    fw.evidence.push({
      timestamp: Date.now(),
      type: "contradicted",
      context: reason,
    });

    store.meta.totalRetired++;
    await this.saveStore(store);
  }

  async recordEvidence(
    frameworkId: string,
    evidence: FrameworkEvidence,
  ): Promise<void> {
    const store = this.store ?? (await this.loadStore());
    const fw = store.frameworks.find((f) => f.id === frameworkId);
    if (!fw) return;

    fw.evidence.push(evidence);
    fw.lastTestedAt = evidence.timestamp;
    fw.applicationCount++;
    fw.confidence = this.calculateConfidence(fw);
    fw.evidenceTier = this.calculateTier(fw);
    this.recalculateStatus(fw);

    await this.saveStore(store);
  }

  /**
   * Tier advancement based on external evidence.
   * hypothesis → observed: at least 1 external confirmed evidence
   * observed → validated: at least 3 external confirmed evidences
   * Tiers only go up, never down. Retirement handles frameworks that don't work.
   */
  calculateTier(framework: Framework): EvidenceTier {
    const externalConfirmed = framework.evidence.filter(
      (e) => e.type === "confirmed" && e.contextType === "external",
    ).length;

    if (externalConfirmed >= 3) return "validated";
    if (externalConfirmed >= 1) return "observed";
    return framework.evidenceTier ?? "hypothesis";
  }

  calculateConfidence(framework: Framework): number {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    let confirmed = 0;
    let contradicted = 0;

    for (const e of framework.evidence) {
      const recencyWeight = now - e.timestamp < sevenDays ? 2 : 1;
      // Self-referential evidence counts at half weight
      const contextWeight = e.contextType === "self-referential" ? 0.5 : 1.0;
      const weight = recencyWeight * contextWeight;
      if (e.type === "confirmed") confirmed += weight;
      else if (e.type === "contradicted") contradicted += weight;
    }

    const ratio = (confirmed - contradicted) / (confirmed + contradicted + 1);
    const usageWeight = Math.min(1, framework.applicationCount / 5);
    const confidence = ratio * usageWeight;

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Rule-based status transitions. Called after evidence/tier updates.
   * - questioning → active: evidenceTier >= "observed" AND confidence >= 0.5
   * - active → questioning: confidence < 0.3 with 5+ evidence
   * - any → retired: confidence < 0.2 with 10+ evidence
   */
  recalculateStatus(framework: Framework): void {
    if (framework.status === "retired" || framework.status === "merged") return;

    const tierRank: Record<string, number> = {
      hypothesis: 0,
      observed: 1,
      validated: 2,
    };

    // Auto-retirement
    if (framework.confidence < 0.2 && framework.evidence.length >= 10) {
      framework.status = "retired";
      return;
    }

    // Promotion: questioning → active
    if (framework.status === "questioning") {
      const rank = tierRank[framework.evidenceTier] ?? 0;
      if (rank >= 1 && framework.confidence >= 0.5) {
        framework.status = "active";
      }
    }

    // Demotion: active → questioning
    if (framework.status === "active") {
      if (framework.confidence < 0.3 && framework.evidence.length >= 5) {
        framework.status = "questioning";
      }
    }
  }

  recalculateAllStatuses(store: FrameworkStore): void {
    for (const fw of store.frameworks) {
      this.recalculateStatus(fw);
    }
  }

  getActiveFrameworks(): Framework[] {
    if (!this.store) return [];
    return this.store.frameworks.filter(
      (f) => f.status === "active" || f.status === "questioning",
    );
  }

  getProcessFrameworks(): Framework[] {
    if (!this.store) return [];
    return this.store.frameworks.filter(
      (f) => f.kind === "process" && (f.status === "active" || f.status === "questioning"),
    );
  }

  getTopFrameworks(n: number): Framework[] {
    const active = this.getActiveFrameworks();
    return active
      .sort(
        (a, b) =>
          b.confidence * Math.log(b.applicationCount + 1) -
          a.confidence * Math.log(a.applicationCount + 1),
      )
      .slice(0, n);
  }

  // --- Migration ---

  private static readonly SELF_REF_KEYWORDS = [
    "soul", "framework", "meta-reflection", "meta-audit",
    "reflection system", "soul system", "operating model",
    "evidence tier", "tier advancement", "self-referential",
    "cargo-cult", "cargo cult", "credibility paradox",
  ];

  /**
   * One-time migration: tag unclassified evidence with contextType,
   * recalculate confidence with self-referential weighting,
   * and run status transitions.
   */
  private migrateV2(store: FrameworkStore): boolean {
    if ((store.schemaVersion ?? 0) >= 2) return false;

    for (const fw of store.frameworks) {
      for (const e of fw.evidence) {
        if (!e.contextType) {
          const lower = e.context.toLowerCase();
          const isSelfRef = FrameworkEngine.SELF_REF_KEYWORDS.some(
            (kw) => lower.includes(kw),
          );
          e.contextType = isSelfRef ? "self-referential" : "unknown";
        }
      }

      // Skip retired/merged — don't resurrect them
      if (fw.status === "retired" || fw.status === "merged") continue;

      // Reset to questioning — everyone re-earns their status through evidence
      fw.status = "questioning";
      fw.confidence = this.calculateConfidence(fw);
      fw.evidenceTier = this.calculateTier(fw);
      this.recalculateStatus(fw);
    }

    store.schemaVersion = 2;
    return true;
  }

  /**
   * V3 migration: add `kind` field to all frameworks.
   * Existing frameworks default to "mental-model". Process seeds get "process".
   */
  private migrateV3(store: FrameworkStore): boolean {
    if ((store.schemaVersion ?? 0) >= 3) return false;

    for (const fw of store.frameworks) {
      if (!fw.kind) {
        fw.kind = fw.domain === "cognitive-process" ? "process" : "mental-model";
      }
    }

    store.schemaVersion = 3;
    return true;
  }

  /**
   * Inject any seed frameworks that are missing from an existing store.
   * This allows new seeds (like cognitive processes) to be added to
   * existing users without requiring a store reset.
   */
  private injectMissingSeeds(store: FrameworkStore): boolean {
    const existingNames = new Set(store.frameworks.map((f) => f.name));
    const now = Date.now();
    let injected = false;

    for (const seed of FRAMEWORK_SEEDS) {
      if (!existingNames.has(seed.name)) {
        store.frameworks.push({
          ...seed,
          id: generateId("fw"),
          createdAt: now,
          lastTestedAt: now,
          evidence: [],
          evidenceTier: "hypothesis" as EvidenceTier,
          relatedFrameworks: [...seed.relatedFrameworks],
          contradicts: [...seed.contradicts],
          supersedes: [...seed.supersedes],
          workflows: [],
        });
        injected = true;
      }
    }

    return injected;
  }
}
