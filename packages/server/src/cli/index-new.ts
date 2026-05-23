#!/usr/bin/env node

// Lightweight indexer for Stop hook — only indexes new journals and lessons.
// Runs silently in <3s. Exits 0 on any error (hooks must be resilient).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, generateId, closeDb } from "../memory/db.js";
import { embed, embeddingToBuffer } from "../memory/embeddings.js";

const HOME = os.homedir();

async function indexNewJournals(): Promise<number> {
  const dir = path.join(HOME, ".soul", "journals");
  if (!fs.existsSync(dir)) return 0;

  const db = getDb();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  let count = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) continue;

    const entries = content.split(/^## /m).filter((e) => e.trim().length > 20);

    for (const entry of entries) {
      const entryContent = `## ${entry}`.trim();

      const existing = db
        .prepare(`SELECT id FROM journal_entries WHERE content LIKE ? LIMIT 1`)
        .get(`${entryContent.slice(0, 80)}%`) as { id: string } | undefined;
      if (existing) continue;

      const headerMatch = entry.match(/^\d{2}:\d{2}\s*—\s*(\S+)/);
      const project = headerMatch?.[1] ?? null;

      const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
      const created = dateMatch ? new Date(dateMatch[1]).getTime() : Date.now();

      const embedding = await embed(entryContent.slice(0, 2000));

      db.prepare(
        `INSERT INTO journal_entries (id, session_id, project, content, created_at, embedding)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(generateId("jrn"), null, project, entryContent, created, embedding ? embeddingToBuffer(embedding) : null);
      count++;
    }
  }

  return count;
}

async function indexNewLessons(): Promise<number> {
  const lessonsPath = path.join(HOME, ".soul", "data", "lessons.json");
  if (!fs.existsSync(lessonsPath)) return 0;

  const db = getDb();
  const data = JSON.parse(fs.readFileSync(lessonsPath, "utf-8")) as Array<{
    id: string;
    lesson: string;
    context: string;
    confidence: number;
  }>;

  let count = 0;

  for (const lesson of data) {
    const content = `${lesson.lesson}\nContext: ${lesson.context}`;

    const existing = db
      .prepare(`SELECT id FROM memories WHERE source_file = ?`)
      .get(`lesson:${lesson.id}`) as { id: string } | undefined;
    if (existing) continue;

    const embedding = await embed(content);
    const now = Date.now();

    db.prepare(
      `INSERT INTO memories (id, content, category, project, source_file, created_at, updated_at, accessed_at, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      generateId("les"),
      content,
      "lesson",
      null,
      `lesson:${lesson.id}`,
      now,
      now,
      now,
      embedding ? embeddingToBuffer(embedding) : null,
    );
    count++;
  }

  return count;
}

async function main() {
  const journals = await indexNewJournals();
  const lessons = await indexNewLessons();

  if (journals + lessons > 0) {
    const logPath = path.join(HOME, ".soul", "data", "index-log.txt");
    const msg = `[${new Date().toISOString()}] Auto-indexed: ${journals} journal(s), ${lessons} lesson(s)\n`;
    fs.appendFileSync(logPath, msg);
  }
}

main()
  .catch(() => {})
  .finally(() => {
    closeDb();
    process.exit(0);
  });
