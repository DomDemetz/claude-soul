import { getDb } from "./db.js";
import { embed, cosineSimilarity, bufferToEmbedding, isUsingFallback } from "./embeddings.js";

export type SearchResult = {
  id: string;
  content: string;
  category: string;
  project: string | null;
  score: number;
  created_at: number;
  source: "memory" | "journal";
};

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "and", "but", "or", "if", "while", "because", "until", "about",
  "what", "which", "who", "whom", "this", "that", "these", "those",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function keywordScore(queryTokens: string[], content: string): number {
  if (queryTokens.length === 0) return 0;
  const contentLower = content.toLowerCase();
  let matched = 0;
  for (const token of queryTokens) {
    if (contentLower.includes(token)) matched++;
  }
  return matched / queryTokens.length;
}

function keywordSearch(
  query: string,
  options: {
    topK: number;
    category?: string;
    project?: string;
    includeArchived: boolean;
    minScore: number;
  },
): SearchResult[] {
  const db = getDb();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  let memorySql = `SELECT id, content, category, project, created_at FROM memories WHERE 1=1`;
  const params: unknown[] = [];

  if (!options.includeArchived) {
    memorySql += ` AND archived = 0`;
  }
  if (options.category) {
    memorySql += ` AND category = ?`;
    params.push(options.category);
  }
  if (options.project) {
    memorySql += ` AND project = ?`;
    params.push(options.project);
  }

  const memories = db.prepare(memorySql).all(...params) as Array<{
    id: string;
    content: string;
    category: string;
    project: string | null;
    created_at: number;
  }>;

  let journalSql = `SELECT id, content, project, created_at FROM journal_entries WHERE 1=1`;
  const journalParams: unknown[] = [];
  if (options.project) {
    journalSql += ` AND project = ?`;
    journalParams.push(options.project);
  }

  const journals = db.prepare(journalSql).all(...journalParams) as Array<{
    id: string;
    content: string;
    project: string | null;
    created_at: number;
  }>;

  const results: SearchResult[] = [];

  for (const mem of memories) {
    const score = keywordScore(queryTokens, mem.content);
    if (score >= options.minScore) {
      results.push({
        id: mem.id,
        content: mem.content,
        category: mem.category,
        project: mem.project,
        score,
        created_at: mem.created_at,
        source: "memory",
      });
    }
  }

  for (const entry of journals) {
    const score = keywordScore(queryTokens, entry.content);
    if (score >= options.minScore) {
      results.push({
        id: entry.id,
        content: entry.content,
        category: "journal",
        project: entry.project,
        score,
        created_at: entry.created_at,
        source: "journal",
      });
    }
  }

  results.sort((a, b) => b.score - a.score);

  const now = Date.now();
  const updateAccess = db.prepare(
    `UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?`,
  );
  for (const r of results.slice(0, options.topK)) {
    if (r.source === "memory") {
      updateAccess.run(now, r.id);
    }
  }

  db.prepare(`INSERT INTO search_log (query, results_count, created_at) VALUES (?, ?, ?)`).run(
    query,
    Math.min(results.length, options.topK),
    now,
  );

  return results.slice(0, options.topK);
}

export async function searchMemories(
  query: string,
  options: {
    topK?: number;
    category?: string;
    project?: string;
    includeArchived?: boolean;
    minScore?: number;
  } = {},
): Promise<SearchResult[]> {
  const {
    topK = 5,
    category,
    project,
    includeArchived = false,
    minScore = 0.3,
  } = options;

  // Fall back to keyword search when Ollama is unavailable
  if (isUsingFallback()) {
    return keywordSearch(query, { topK, category, project, includeArchived, minScore: 0.2 });
  }

  const db = getDb();
  const queryEmbedding = await embed(query);

  if (!queryEmbedding) {
    return keywordSearch(query, { topK, category, project, includeArchived, minScore: 0.2 });
  }

  let memorySql = `SELECT id, content, category, project, created_at, embedding FROM memories WHERE embedding IS NOT NULL`;
  const params: unknown[] = [];

  if (!includeArchived) {
    memorySql += ` AND archived = 0`;
  }
  if (category) {
    memorySql += ` AND category = ?`;
    params.push(category);
  }
  if (project) {
    memorySql += ` AND project = ?`;
    params.push(project);
  }

  const memories = db.prepare(memorySql).all(...params) as Array<{
    id: string;
    content: string;
    category: string;
    project: string | null;
    created_at: number;
    embedding: Buffer;
  }>;

  let journalSql = `SELECT id, content, project, created_at, embedding FROM journal_entries WHERE embedding IS NOT NULL`;
  const journalParams: unknown[] = [];

  if (project) {
    journalSql += ` AND project = ?`;
    journalParams.push(project);
  }

  const journals = db.prepare(journalSql).all(...journalParams) as Array<{
    id: string;
    content: string;
    project: string | null;
    created_at: number;
    embedding: Buffer;
  }>;

  const results: SearchResult[] = [];

  for (const mem of memories) {
    const memEmbedding = bufferToEmbedding(mem.embedding);
    const score = cosineSimilarity(queryEmbedding, memEmbedding);
    if (score >= minScore) {
      results.push({
        id: mem.id,
        content: mem.content,
        category: mem.category,
        project: mem.project,
        score,
        created_at: mem.created_at,
        source: "memory",
      });
    }
  }

  for (const entry of journals) {
    const entryEmbedding = bufferToEmbedding(entry.embedding);
    const score = cosineSimilarity(queryEmbedding, entryEmbedding);
    if (score >= minScore) {
      results.push({
        id: entry.id,
        content: entry.content,
        category: "journal",
        project: entry.project,
        score,
        created_at: entry.created_at,
        source: "journal",
      });
    }
  }

  results.sort((a, b) => b.score - a.score);

  const updateAccess = db.prepare(
    `UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?`,
  );
  const now = Date.now();
  for (const r of results.slice(0, topK)) {
    if (r.source === "memory") {
      updateAccess.run(now, r.id);
    }
  }

  db.prepare(`INSERT INTO search_log (query, results_count, created_at) VALUES (?, ?, ?)`).run(
    query,
    Math.min(results.length, topK),
    now,
  );

  return results.slice(0, topK);
}
