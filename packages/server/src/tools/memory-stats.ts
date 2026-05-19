import { getDb } from "../memory/db.js";
import { isUsingFallback } from "../memory/embeddings.js";

export async function handleMemoryStats(): Promise<string> {
  const db = getDb();

  const memCount = (db.prepare(`SELECT COUNT(*) as c FROM memories`).get() as { c: number }).c;
  const journalCount = (db.prepare(`SELECT COUNT(*) as c FROM journal_entries`).get() as { c: number }).c;
  const archivedCount = (db.prepare(`SELECT COUNT(*) as c FROM memories WHERE archived = 1`).get() as { c: number }).c;
  const searchCount = (db.prepare(`SELECT COUNT(*) as c FROM search_log`).get() as { c: number }).c;

  const byCategory = db
    .prepare(`SELECT category, COUNT(*) as c FROM memories WHERE archived = 0 GROUP BY category ORDER BY c DESC`)
    .all() as Array<{ category: string; c: number }>;

  const byProject = db
    .prepare(
      `SELECT COALESCE(project, '(no project)') as project, COUNT(*) as c FROM memories WHERE archived = 0 GROUP BY project ORDER BY c DESC LIMIT 10`,
    )
    .all() as Array<{ project: string; c: number }>;

  const topAccessed = db
    .prepare(`SELECT content, access_count, category FROM memories WHERE access_count > 0 ORDER BY access_count DESC LIMIT 5`)
    .all() as Array<{ content: string; access_count: number; category: string }>;

  const recentSearches = db
    .prepare(`SELECT query, results_count, created_at FROM search_log ORDER BY created_at DESC LIMIT 5`)
    .all() as Array<{ query: string; results_count: number; created_at: number }>;

  let output = `## Memory Stats\n\n`;
  output += `- **Memories**: ${memCount} active, ${archivedCount} archived\n`;
  output += `- **Journal entries**: ${journalCount}\n`;
  output += `- **Searches performed**: ${searchCount}\n`;
  output += `- **Search mode**: ${isUsingFallback() ? "keyword (Ollama not available)" : "semantic (Ollama)"}\n\n`;

  if (byCategory.length > 0) {
    output += `### By Category\n`;
    for (const { category, c } of byCategory) {
      output += `- ${category}: ${c}\n`;
    }
    output += "\n";
  }

  if (byProject.length > 0) {
    output += `### By Project\n`;
    for (const { project, c } of byProject) {
      output += `- ${project}: ${c}\n`;
    }
    output += "\n";
  }

  if (topAccessed.length > 0) {
    output += `### Most Accessed\n`;
    for (const { content, access_count, category } of topAccessed) {
      output += `- (${access_count}x, ${category}) ${content.slice(0, 80)}\n`;
    }
    output += "\n";
  }

  if (recentSearches.length > 0) {
    output += `### Recent Searches\n`;
    for (const { query, results_count, created_at } of recentSearches) {
      const date = new Date(created_at).toISOString().slice(0, 16).replace("T", " ");
      output += `- "${query}" → ${results_count} results (${date})\n`;
    }
  }

  return output;
}
