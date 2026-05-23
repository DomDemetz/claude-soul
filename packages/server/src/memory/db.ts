import path from "node:path";
import fs from "node:fs";
import os from "node:os";

let Database: any;
try {
  Database = (await import("better-sqlite3")).default;
} catch {
  Database = null;
}

const DB_DIR = path.join(os.homedir(), ".soul", "data");
const DB_PATH = path.join(DB_DIR, "memory.db");

let _db: any = null;
let _unavailable = false;

export function isDbAvailable(): boolean {
  return Database !== null;
}

export function getDb(): any {
  if (_db) return _db;
  if (_unavailable || !Database) {
    _unavailable = true;
    throw new Error(
      "Memory database unavailable — better-sqlite3 failed to load. " +
      "This is usually a native compilation issue. Memory features are disabled but everything else works. " +
      "Try: npm rebuild better-sqlite3"
    );
  }

  try {
    fs.mkdirSync(DB_DIR, { recursive: true });
    _db = new Database(DB_PATH);

    _db.pragma("journal_mode = WAL");

    _db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        project TEXT,
        source_file TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        embedding BLOB
      );

      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        project TEXT,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        embedding BLOB
      );

      CREATE TABLE IF NOT EXISTS search_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        results_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived);
      CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_at);
      CREATE INDEX IF NOT EXISTS idx_journal_project ON journal_entries(project);
    `);

    return _db;
  } catch (err) {
    _unavailable = true;
    throw new Error(`Memory database failed to initialize: ${err}`);
  }
}

export function generateId(prefix: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${ts}-${rand}`;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
