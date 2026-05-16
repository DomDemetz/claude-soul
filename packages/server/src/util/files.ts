import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { SoulConfig } from "../types/config-types.js";
import { DEFAULT_CONFIG } from "../types/config-types.js";

export const SOUL_DIR = path.join(os.homedir(), ".soul");
export const DATA_DIR = path.join(SOUL_DIR, "data");
export const FILES_DIR = path.join(SOUL_DIR, "files");
export const SNAPSHOTS_DIR = path.join(DATA_DIR, "snapshots");
export const REFLECTIONS_DIR = path.join(SOUL_DIR, "reflections");

export const FRAMEWORKS_PATH = path.join(DATA_DIR, "frameworks.json");
export const SESSION_LOG_PATH = path.join(DATA_DIR, "session-log.jsonl");
export const STATE_PATH = path.join(DATA_DIR, "state.json");
export const TENSIONS_PATH = path.join(DATA_DIR, "tensions.json");
export const EXEMPLARS_PATH = path.join(DATA_DIR, "exemplars.json");
export const LESSONS_PATH = path.join(DATA_DIR, "lessons.json");
export const META_PATH = path.join(DATA_DIR, "meta.json");
export const CONFIG_PATH = path.join(SOUL_DIR, "config.json");

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(FILES_DIR, { recursive: true });
  await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  await fs.mkdir(REFLECTIONS_DIR, { recursive: true });
}

export async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}

export async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

export async function loadConfig(): Promise<SoulConfig> {
  return readJsonSafe<SoulConfig>(CONFIG_PATH, DEFAULT_CONFIG);
}

export function soulFilePath(name: string): string {
  return path.join(FILES_DIR, name);
}
