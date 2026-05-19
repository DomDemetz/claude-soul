import { searchMemories, type SearchResult } from "../memory/search.js";
import { isUsingFallback } from "../memory/embeddings.js";

export async function handleMemorySearch(
  query: string,
  options?: { category?: string; project?: string; topK?: number },
): Promise<string> {
  const results = await searchMemories(query, {
    topK: options?.topK ?? 5,
    category: options?.category,
    project: options?.project,
  });

  if (results.length === 0) {
    return `No memories found matching "${query}".`;
  }

  const lines = results.map((r, i) => formatResult(r, i + 1));
  const fallbackNote = isUsingFallback() ? "\n\n*Using keyword search — install Ollama for semantic search.*" : "";
  return `Found ${results.length} result(s) for "${query}":\n\n${lines.join("\n\n")}${fallbackNote}`;
}

function formatResult(r: SearchResult, rank: number): string {
  const date = new Date(r.created_at).toISOString().slice(0, 10);
  const score = (r.score * 100).toFixed(0);
  const project = r.project ? ` [${r.project}]` : "";
  const source = r.source === "journal" ? " (journal)" : ` (${r.category})`;

  return `**${rank}. ${score}% match**${project}${source} — ${date}\n${r.content}`;
}
