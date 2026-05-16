import type { Framework, Tension, TensionState } from "../types/learning-types.js";
import { TENSIONS_PATH } from "../util/files.js";
import { readJsonSafe, writeJsonAtomic } from "../util/files.js";

/**
 * Detect contradictions between active frameworks based on their domains,
 * descriptions, and evidence patterns.
 */
export async function detectTensions(
  frameworks: Framework[],
): Promise<Tension[]> {
  const active = frameworks.filter(
    (f) => f.status === "active" || f.status === "questioning",
  );
  const tensionState = await readJsonSafe<TensionState>(TENSIONS_PATH, { tensions: [] });
  const existingPairs = new Set(
    tensionState.tensions.map((t) => [t.frameworkA, t.frameworkB].sort().join("|")),
  );

  const newTensions: Tension[] = [];

  // Check for contradictions based on framework metadata
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const pairKey = [a.id, b.id].sort().join("|");

      if (existingPairs.has(pairKey)) continue;

      // Check if explicitly marked as contradicting
      if (a.contradicts.includes(b.id) || b.contradicts.includes(a.id)) {
        newTensions.push(makeTension(a, b));
        existingPairs.add(pairKey);
        continue;
      }

      // Heuristic: frameworks in the same domain with divergent evidence patterns
      if (a.domain === b.domain && a.evidence.length >= 3 && b.evidence.length >= 3) {
        const aConfirmed = a.evidence.filter((e) => e.type === "confirmed").length;
        const bContradicted = b.evidence.filter((e) => e.type === "contradicted").length;
        const bConfirmed = b.evidence.filter((e) => e.type === "confirmed").length;
        const aContradicted = a.evidence.filter((e) => e.type === "contradicted").length;

        // If one is mostly confirmed when the other is contradicted (or vice versa)
        if (
          (aConfirmed > aContradicted && bContradicted > bConfirmed) ||
          (bConfirmed > bContradicted && aContradicted > aConfirmed)
        ) {
          newTensions.push(makeTension(a, b));
          existingPairs.add(pairKey);
        }
      }
    }
  }

  if (newTensions.length > 0) {
    tensionState.tensions.push(...newTensions);
    await writeJsonAtomic(TENSIONS_PATH, tensionState);
  }

  return newTensions;
}

function makeTension(a: Framework, b: Framework): Tension {
  return {
    id: `ten-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    frameworkA: a.id,
    frameworkB: b.id,
    description: `"${a.name}" vs "${b.name}"`,
    preferredInContext: {},
    status: "detected",
    detectedAt: Date.now(),
  };
}

/**
 * Record a context preference for a tension.
 */
export async function recordTensionPreference(
  tensionId: string,
  context: string,
  preferredFrameworkId: string,
  evidence: string,
): Promise<void> {
  const state = await readJsonSafe<TensionState>(TENSIONS_PATH, { tensions: [] });
  const tension = state.tensions.find((t) => t.id === tensionId);
  if (!tension) return;

  const pref = tension.preferredInContext[context] ?? {
    preferred: preferredFrameworkId,
    confirmedCount: 0,
    evidence: [],
  };

  pref.preferred = preferredFrameworkId;
  pref.confirmedCount++;
  pref.evidence = [...pref.evidence, evidence].slice(-5);
  tension.preferredInContext[context] = pref;

  await writeJsonAtomic(TENSIONS_PATH, state);
}
