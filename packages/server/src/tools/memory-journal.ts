import { getDb } from "../memory/db.js";
import { searchMemories } from "../memory/search.js";

export async function handleMemoryJournal(
  query?: string,
  days?: number,
): Promise<string> {
  const db = getDb();

  if (query) {
    const results = await searchMemories(query, {
      topK: 5,
      minScore: 0.25,
    });
    const journalResults = results.filter((r) => r.source === "journal");

    if (journalResults.length === 0) {
      return `No journal entries found matching "${query}".`;
    }

    const lines = journalResults.map((r) => {
      const date = new Date(r.created_at).toISOString().slice(0, 10);
      const score = (r.score * 100).toFixed(0);
      const project = r.project ? ` [${r.project}]` : "";
      return `**${score}% match**${project} — ${date}\n${r.content}`;
    });

    return `Found ${journalResults.length} journal entry(s):\n\n${lines.join("\n\n")}`;
  }

  const cutoff = Date.now() - (days ?? 7) * 24 * 60 * 60 * 1000;
  const entries = db
    .prepare(
      `SELECT id, content, project, created_at FROM journal_entries
       WHERE created_at >= ? ORDER BY created_at DESC LIMIT 20`,
    )
    .all(cutoff) as Array<{
    id: string;
    content: string;
    project: string | null;
    created_at: number;
  }>;

  if (entries.length === 0) {
    return `No journal entries in the last ${days ?? 7} day(s).`;
  }

  const lines = entries.map((e) => {
    const date = new Date(e.created_at).toISOString().slice(0, 16).replace("T", " ");
    const project = e.project ? ` [${e.project}]` : "";
    return `**${date}**${project}\n${e.content.slice(0, 200)}`;
  });

  return `${entries.length} journal entry(s) from the last ${days ?? 7} day(s):\n\n${lines.join("\n\n")}`;
}
