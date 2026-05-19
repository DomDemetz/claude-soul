import { searchMemories, type SearchResult } from "../memory/search.js";
import { isUsingFallback } from "../memory/embeddings.js";

export async function handleRecall(query: string): Promise<string> {
  const results = await searchMemories(query, { topK: 10, minScore: 0.25 });

  if (results.length === 0) {
    return `No memories found for "${query}".`;
  }

  const frameworks = results.filter((r) => r.category === "framework");
  const lessons = results.filter((r) => r.category === "lesson");
  const journals = results.filter((r) => r.source === "journal");
  const facts = results.filter(
    (r) => r.category !== "framework" && r.category !== "lesson" && r.source !== "journal",
  );

  const sections: string[] = [];

  if (facts.length > 0) {
    sections.push("## Facts & Decisions\n" + facts.map((r) => formatResult(r)).join("\n\n"));
  }
  if (frameworks.length > 0) {
    sections.push("## Relevant Frameworks\n" + frameworks.map((r) => formatResult(r)).join("\n\n"));
  }
  if (lessons.length > 0) {
    sections.push("## Lessons\n" + lessons.map((r) => formatResult(r)).join("\n\n"));
  }
  if (journals.length > 0) {
    sections.push("## From Past Conversations\n" + journals.map((r) => formatResult(r)).join("\n\n"));
  }

  const fallbackNote = isUsingFallback() ? "\n\n---\n*Using keyword search — install Ollama for semantic search.*" : "";
  return sections.join("\n\n---\n\n") + fallbackNote;
}

function formatResult(r: SearchResult): string {
  const score = (r.score * 100).toFixed(0);
  const date = new Date(r.created_at).toISOString().slice(0, 10);
  const project = r.project ? ` [${r.project}]` : "";
  return `**${score}% match**${project} — ${date}\n${r.content.slice(0, 300)}${r.content.length > 300 ? "..." : ""}`;
}
