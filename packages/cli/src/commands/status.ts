import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const SOUL_DIR = path.join(os.homedir(), ".soul");
const DATA_DIR = path.join(SOUL_DIR, "data");

export async function statusCommand(): Promise<void> {
  console.log("");
  console.log("  Claude Soul — Status");
  console.log("  ────────────────────");
  console.log("");

  try {
    await fs.access(SOUL_DIR);
  } catch {
    console.log("  Not installed. Run 'claude-soul init' to set up.");
    return;
  }

  // Frameworks
  try {
    const data = await fs.readFile(path.join(DATA_DIR, "frameworks.json"), "utf-8");
    const store = JSON.parse(data);
    const active = store.frameworks.filter((f: { status: string }) => f.status === "active").length;
    const questioning = store.frameworks.filter((f: { status: string }) => f.status === "questioning").length;
    const retired = store.frameworks.filter((f: { status: string }) => f.status === "retired").length;
    console.log(`  Frameworks: ${active} active, ${questioning} questioning, ${retired} retired`);

    const lastReflection = store.meta.lastReflectionAt;
    if (lastReflection > 0) {
      const ago = Math.floor((Date.now() - lastReflection) / (1000 * 60 * 60));
      console.log(`  Last reflection: ${ago}h ago (${store.meta.reflectionCount} total)`);
    } else {
      console.log("  Last reflection: never");
    }
  } catch {
    console.log("  Frameworks: not initialized yet");
  }

  // Signals — per-tier under B-contract (issue #6): total queue size is no
  // longer the same as "pending" because signals persist across reflections.
  try {
    const content = await fs.readFile(path.join(DATA_DIR, "session-log.jsonl"), "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
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
        pendingQuick++;
        pendingDeep++;
      }
    }
    console.log(
      `  Signals: ${lines.length} total (${pendingQuick} pending quick, ${pendingDeep} pending deep, ${corrections} corrections)`,
    );
  } catch {
    console.log("  Signals: 0 total");
  }

  // Meta
  try {
    const data = await fs.readFile(path.join(DATA_DIR, "meta.json"), "utf-8");
    const meta = JSON.parse(data);
    console.log(`  Learning phase: ${meta.phase ?? "apprentice"}`);
    console.log(`  Framework survival rate: ${((meta.frameworkSurvivalRate ?? 1) * 100).toFixed(0)}%`);
  } catch {
    console.log("  Learning phase: apprentice (fresh install)");
  }

  // Follow-ups
  try {
    const data = await fs.readFile(path.join(DATA_DIR, "follow-ups.json"), "utf-8");
    const followUps = JSON.parse(data);
    const unresolved = followUps.filter((f: { resolved?: boolean }) => !f.resolved).length;
    if (unresolved > 0) {
      console.log(`  Unresolved follow-ups: ${unresolved}`);
    }
  } catch {
    // No follow-ups yet
  }

  // Journals
  try {
    const journals = await fs.readdir(path.join(SOUL_DIR, "journals"));
    const mdFiles = journals.filter((f) => f.endsWith(".md"));
    if (mdFiles.length > 0) {
      console.log(`  Journal entries: ${mdFiles.length} days`);
    }
  } catch {
    // No journals yet
  }

  console.log("");
}
