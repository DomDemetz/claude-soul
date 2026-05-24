import fs from "node:fs/promises";
import path from "node:path";
import { FRAMEWORKS_PATH, SNAPSHOTS_DIR } from "../util/files.js";

const MAX_SNAPSHOTS = 20;

export async function createSnapshot(): Promise<string> {
  await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });

  const timestamp = Date.now();
  const nonce = Math.random().toString(36).slice(2, 6);
  const snapshotName = `frameworks.v${timestamp}-${nonce}.json`;
  const snapshotPath = path.join(SNAPSHOTS_DIR, snapshotName);

  try {
    await fs.copyFile(FRAMEWORKS_PATH, snapshotPath);
  } catch {
    // frameworks.json might not exist yet
    return "";
  }

  // Prune old snapshots — keep last MAX_SNAPSHOTS
  const files = await fs.readdir(SNAPSHOTS_DIR);
  const snapshots = files
    .filter((f) => f.startsWith("frameworks.v") && f.endsWith(".json"))
    .sort();

  if (snapshots.length > MAX_SNAPSHOTS) {
    const toDelete = snapshots.slice(0, snapshots.length - MAX_SNAPSHOTS);
    for (const file of toDelete) {
      await fs.unlink(path.join(SNAPSHOTS_DIR, file)).catch(() => {});
    }
  }

  return snapshotPath;
}

export async function listSnapshots(): Promise<string[]> {
  try {
    const files = await fs.readdir(SNAPSHOTS_DIR);
    return files
      .filter((f) => f.startsWith("frameworks.v") && f.endsWith(".json"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function rollbackToSnapshot(snapshotName: string): Promise<boolean> {
  const snapshotPath = path.join(SNAPSHOTS_DIR, snapshotName);
  try {
    await fs.copyFile(snapshotPath, FRAMEWORKS_PATH);
    return true;
  } catch {
    return false;
  }
}
