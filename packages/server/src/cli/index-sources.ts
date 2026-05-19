#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { getDb, generateId, closeDb } from "../memory/db.js";
import { embed, embeddingToBuffer, checkOllama } from "../memory/embeddings.js";

const HOME = process.env.HOME ?? "/tmp";

async function indexSoulFiles(): Promise<number> {
  const dir = path.join(HOME, ".soul", "files");
  if (!fs.existsSync(dir)) return 0;

  const db = getDb();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  let count = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content || content.length < 20) continue;

    const existing = db
      .prepare(`SELECT id FROM memories WHERE source_file = ?`)
      .get(filePath) as { id: string } | undefined;
    if (existing) continue;

    console.log(`  Indexing soul file: ${file}`);
    const embedding = await embed(content.slice(0, 2000));
    const now = Date.now();

    db.prepare(
      `INSERT INTO memories (id, content, category, project, source_file, created_at, updated_at, accessed_at, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      generateId("soul"),
      content,
      "architecture",
      null,
      filePath,
      now,
      now,
      now,
      embedding ? embeddingToBuffer(embedding) : null,
    );
    count++;
  }

  return count;
}

async function indexNativeMemories(): Promise<number> {
  const projectsDir = path.join(HOME, ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return 0;

  const db = getDb();
  let count = 0;

  const projectDirs = fs.readdirSync(projectsDir);
  for (const projDir of projectDirs) {
    const memDir = path.join(projectsDir, projDir, "memory");
    if (!fs.existsSync(memDir)) continue;

    const files = fs.readdirSync(memDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
    for (const file of files) {
      const filePath = path.join(memDir, file);
      const content = fs.readFileSync(filePath, "utf-8").trim();
      if (!content || content.length < 20) continue;

      const existing = db
        .prepare(`SELECT id FROM memories WHERE source_file = ?`)
        .get(filePath) as { id: string } | undefined;
      if (existing) continue;

      const projectName = projDir.split("-").pop() ?? projDir;

      console.log(`  Indexing native memory: ${projDir}/${file}`);
      const embedding = await embed(content.slice(0, 2000));
      const stat = fs.statSync(filePath);
      const created = stat.mtimeMs;

      db.prepare(
        `INSERT INTO memories (id, content, category, project, source_file, created_at, updated_at, accessed_at, embedding)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        generateId("nat"),
        content,
        "general",
        projectName,
        filePath,
        created,
        created,
        created,
        embedding ? embeddingToBuffer(embedding) : null,
      );
      count++;
    }
  }

  return count;
}

async function indexJournals(): Promise<number> {
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

      console.log(`  Indexing journal entry: ${file} (${entryContent.slice(0, 40)}...)`);
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

async function indexLessons(): Promise<number> {
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

    console.log(`  Indexing lesson: ${lesson.lesson.slice(0, 50)}...`);
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

async function indexFrameworks(): Promise<number> {
  const frameworksPath = path.join(HOME, ".soul", "data", "frameworks.json");
  if (!fs.existsSync(frameworksPath)) return 0;

  const db = getDb();
  const data = JSON.parse(fs.readFileSync(frameworksPath, "utf-8")) as {
    frameworks: Array<{
      id: string;
      name: string;
      description: string;
      domain: string;
      confidence: number;
      evidenceTier: string;
      status: string;
      evidence: Array<{ type: string }>;
      applicationCount: number;
    }>;
  };

  let count = 0;

  for (const fw of data.frameworks) {
    if (fw.status === "retired" || fw.status === "merged") continue;

    const sourceKey = `framework:${fw.id}`;
    const existing = db
      .prepare(`SELECT id FROM memories WHERE source_file = ?`)
      .get(sourceKey) as { id: string } | undefined;
    if (existing) continue;

    const confirmed = fw.evidence.filter((e) => e.type === "confirmed").length;
    const contradicted = fw.evidence.filter((e) => e.type === "contradicted").length;

    const content = [
      `Framework: ${fw.name}`,
      `Domain: ${fw.domain}`,
      `Status: ${fw.status} | Confidence: ${fw.confidence.toFixed(2)} | Tier: ${fw.evidenceTier}`,
      `Description: ${fw.description}`,
      `Evidence: ${confirmed} confirmed, ${contradicted} contradicted`,
      `Applications: ${fw.applicationCount}`,
    ].join("\n");

    console.log(`  Indexing framework: ${fw.name} (${fw.status}, conf: ${fw.confidence.toFixed(2)})`);
    const embedding = await embed(content.slice(0, 2000));
    const now = Date.now();

    db.prepare(
      `INSERT INTO memories (id, content, category, project, source_file, created_at, updated_at, accessed_at, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      generateId("fw"),
      content,
      "framework",
      null,
      sourceKey,
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
  console.log("Memory Indexer — Scanning all sources\n");

  const ollamaStatus = await checkOllama();
  if (!ollamaStatus.ok) {
    console.log(`  [!] ${ollamaStatus.error}`);
    console.log("      Indexing will proceed without embeddings (keyword search only).\n");
  } else {
    console.log("  Ollama: connected\n");
  }

  console.log("1. Soul files (~/.soul/files/)");
  const soulCount = await indexSoulFiles();
  console.log(`   -> ${soulCount} new file(s) indexed\n`);

  console.log("2. Native Claude Code memories (~/.claude/projects/*/memory/)");
  const nativeCount = await indexNativeMemories();
  console.log(`   -> ${nativeCount} new memory(s) indexed\n`);

  console.log("3. Journals (~/.soul/journals/)");
  const journalCount = await indexJournals();
  console.log(`   -> ${journalCount} new entry(s) indexed\n`);

  console.log("4. Soul lessons (~/.soul/data/lessons.json)");
  const lessonCount = await indexLessons();
  console.log(`   -> ${lessonCount} new lesson(s) indexed\n`);

  console.log("5. Soul frameworks (~/.soul/data/frameworks.json)");
  const frameworkCount = await indexFrameworks();
  console.log(`   -> ${frameworkCount} new framework(s) indexed\n`);

  const total = soulCount + nativeCount + journalCount + lessonCount + frameworkCount;
  console.log(`Done. ${total} total new items indexed.`);

  closeDb();
}

main().catch((err) => {
  console.error("Indexer error:", err);
  closeDb();
  process.exit(1);
});
