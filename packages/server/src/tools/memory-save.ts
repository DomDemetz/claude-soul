import { getDb, generateId } from "../memory/db.js";
import { embed, embeddingToBuffer } from "../memory/embeddings.js";

export type MemoryCategory =
  | "decision"
  | "preference"
  | "fact"
  | "episode"
  | "lesson"
  | "architecture"
  | "framework"
  | "general";

export async function handleMemorySave(
  content: string,
  category: MemoryCategory = "general",
  project?: string,
): Promise<string> {
  const db = getDb();
  const now = Date.now();
  const id = generateId("mem");

  const embedding = await embed(content);
  const embeddingBuf = embedding ? embeddingToBuffer(embedding) : null;

  db.prepare(
    `INSERT INTO memories (id, content, category, project, created_at, updated_at, accessed_at, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, content, category, project ?? null, now, now, now, embeddingBuf);

  const projectStr = project ? ` [${project}]` : "";
  return `Saved memory ${id}${projectStr} (${category}):\n${content.slice(0, 100)}${content.length > 100 ? "..." : ""}`;
}
