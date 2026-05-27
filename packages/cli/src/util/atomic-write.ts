import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// CLI-side mirror of packages/server/src/util/files.ts#writeFileAtomic. Kept in
// lockstep with the server copy — any fix to one must be applied to the other.
// PID + UUID suffix prevents collisions between concurrent same-PID callers.
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
