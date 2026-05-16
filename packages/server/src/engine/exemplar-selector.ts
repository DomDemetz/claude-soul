import type { Exemplar, Framework } from "../types/learning-types.js";

/**
 * Select the most relevant exemplars for the current context.
 * Matches by domain and active framework overlap.
 */
export function selectExemplars(
  exemplars: Exemplar[],
  activeFrameworks: Framework[],
  maxCount: number,
): Exemplar[] {
  if (exemplars.length === 0) return [];

  const activeNames = new Set(activeFrameworks.map((f) => f.name));

  // Score each exemplar by framework overlap + recency
  const scored = exemplars.map((ex) => {
    const frameworkOverlap = ex.frameworksActive.filter((f) => activeNames.has(f)).length;
    const recencyScore = Math.max(0, 1 - (Date.now() - ex.createdAt) / (30 * 24 * 60 * 60 * 1000)); // 30-day decay
    const score = frameworkOverlap * 2 + recencyScore;
    return { exemplar: ex, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount)
    .map((s) => s.exemplar);
}
