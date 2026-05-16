import { estimateTokens } from "../util/tokens.js";

export type ContentBlock = {
  content: string;
  tier: 1 | 2 | 3;
  label: string;
  fallback?: string; // compressed version to try if full content doesn't fit
};

/**
 * Apply the 3-tier token budget. Tier 1 is always included.
 * Tier 2 fills to budget (with fallback support). Tier 3 if room remains.
 * Returns the assembled content within the budget.
 */
export function applyTokenBudget(
  blocks: ContentBlock[],
  maxTokens: number,
): string {
  const tier1 = blocks.filter((b) => b.tier === 1);
  const tier2 = blocks.filter((b) => b.tier === 2);
  const tier3 = blocks.filter((b) => b.tier === 3);

  const result: string[] = [];
  let usedTokens = 0;

  // Tier 1: always include
  for (const block of tier1) {
    const tokens = estimateTokens(block.content);
    result.push(block.content);
    usedTokens += tokens;
  }

  // Tier 2: fill to budget, try fallback if primary doesn't fit
  for (const block of tier2) {
    const tokens = estimateTokens(block.content);
    if (usedTokens + tokens <= maxTokens) {
      result.push(block.content);
      usedTokens += tokens;
    } else if (block.fallback) {
      const fallbackTokens = estimateTokens(block.fallback);
      if (usedTokens + fallbackTokens <= maxTokens) {
        result.push(block.fallback);
        usedTokens += fallbackTokens;
      }
    }
  }

  // Tier 3: if room remains
  for (const block of tier3) {
    const tokens = estimateTokens(block.content);
    if (usedTokens + tokens <= maxTokens) {
      result.push(block.content);
      usedTokens += tokens;
    }
  }

  return result.join("\n\n---\n\n");
}
