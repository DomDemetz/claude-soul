import { getDb } from "../memory/db.js";

export async function handleMemoryRecent(
  days?: number,
  project?: string,
): Promise<string> {
  const db = getDb();
  const cutoff = Date.now() - (days ?? 7) * 24 * 60 * 60 * 1000;

  let sql = `SELECT id, content, category, project, created_at FROM memories
             WHERE created_at >= ? AND archived = 0`;
  const params: unknown[] = [cutoff];

  if (project) {
    sql += ` AND project = ?`;
    params.push(project);
  }

  sql += ` ORDER BY created_at DESC LIMIT 20`;

  const memories = db.prepare(sql).all(...params) as Array<{
    id: string;
    content: string;
    category: string;
    project: string | null;
    created_at: number;
  }>;

  if (memories.length === 0) {
    const projectStr = project ? ` for project "${project}"` : "";
    return `No memories in the last ${days ?? 7} day(s)${projectStr}.`;
  }

  const lines = memories.map((m) => {
    const date = new Date(m.created_at).toISOString().slice(0, 16).replace("T", " ");
    const projectTag = m.project ? ` [${m.project}]` : "";
    return `- **${date}** (${m.category})${projectTag}: ${m.content.slice(0, 150)}`;
  });

  return `${memories.length} recent memory(s):\n\n${lines.join("\n")}`;
}
