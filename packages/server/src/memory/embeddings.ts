import { Ollama } from "ollama";

const MODEL = "nomic-embed-text";

let _client: Ollama | null = null;
let _fallbackMode: boolean | null = null; // null = not yet checked
let _fallbackWarned = false;

function getClient(): Ollama {
  if (!_client) {
    _client = new Ollama();
  }
  return _client;
}

function logFallbackWarning(): void {
  if (_fallbackWarned) return;
  _fallbackWarned = true;
  console.error(
    "[claude-soul] Ollama not available — memory will use keyword search.\n" +
      "  For semantic search, install Ollama: https://ollama.com\n" +
      `  Then run: ollama pull ${MODEL}`,
  );
}

export function isUsingFallback(): boolean {
  return _fallbackMode === true;
}

async function ensureOllama(): Promise<boolean> {
  if (_fallbackMode === true) return false;
  if (_fallbackMode === false) return true;

  // First check — determine if Ollama is available
  try {
    const client = getClient();
    const models = await client.list();
    const hasModel = models.models.some((m) => m.name.startsWith(MODEL));
    if (!hasModel) {
      _fallbackMode = true;
      logFallbackWarning();
      return false;
    }
    _fallbackMode = false;
    return true;
  } catch {
    _fallbackMode = true;
    logFallbackWarning();
    return false;
  }
}

export async function embed(text: string): Promise<Float32Array | null> {
  const available = await ensureOllama();
  if (!available) return null;

  const client = getClient();
  const response = await client.embed({ model: MODEL, input: text });
  return new Float32Array(response.embeddings[0]);
}

export async function embedMany(texts: string[]): Promise<(Float32Array | null)[]> {
  if (texts.length === 0) return [];

  const available = await ensureOllama();
  if (!available) return texts.map(() => null);

  const client = getClient();
  const response = await client.embed({ model: MODEL, input: texts });
  return response.embeddings.map((e) => new Float32Array(e));
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

export function bufferToEmbedding(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

export async function checkOllama(): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getClient();
    const models = await client.list();
    const hasModel = models.models.some((m) => m.name.startsWith(MODEL));
    if (!hasModel) {
      return {
        ok: false,
        error: `Model '${MODEL}' not found. Run: ollama pull ${MODEL}`,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: `Ollama not reachable. Is it running? Try: ollama serve`,
    };
  }
}
