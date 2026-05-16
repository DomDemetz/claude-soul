import fs from "node:fs/promises";
import type { MicroSignal } from "../types/learning-types.js";
import { SESSION_LOG_PATH, DATA_DIR } from "../util/files.js";

const MAX_FILE_SIZE = 50 * 1024; // 50KB

export async function appendSignals(signals: MicroSignal[]): Promise<void> {
  if (signals.length === 0) return;

  await fs.mkdir(DATA_DIR, { recursive: true });

  const newLines = signals.map((s) => JSON.stringify(s)).join("\n") + "\n";
  await fs.appendFile(SESSION_LOG_PATH, newLines, "utf8");

  // Check file size and truncate if over 50KB
  try {
    const stat = await fs.stat(SESSION_LOG_PATH);
    if (stat.size > MAX_FILE_SIZE) {
      const content = await fs.readFile(SESSION_LOG_PATH, "utf8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);

      let truncated = lines;
      while (truncated.length > 0) {
        const joined = truncated.join("\n") + "\n";
        if (Buffer.byteLength(joined, "utf8") <= MAX_FILE_SIZE) {
          await fs.writeFile(SESSION_LOG_PATH, joined, "utf8");
          break;
        }
        truncated = truncated.slice(1);
      }

      if (truncated.length === 0) {
        await fs.writeFile(SESSION_LOG_PATH, "", "utf8");
      }
    }
  } catch {
    // File doesn't exist yet, that's fine
  }
}

export async function readSignals(): Promise<MicroSignal[]> {
  try {
    const content = await fs.readFile(SESSION_LOG_PATH, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    return lines.map((l) => JSON.parse(l) as MicroSignal);
  } catch {
    return [];
  }
}

export async function clearSignals(): Promise<void> {
  try {
    await fs.writeFile(SESSION_LOG_PATH, "", "utf8");
  } catch {
    // Ignore
  }
}

export async function getSignalCount(): Promise<number> {
  const signals = await readSignals();
  return signals.length;
}
