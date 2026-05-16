import fs from "node:fs/promises";
import { soulFilePath, ensureDirs } from "../util/files.js";

const WRITABLE_FILES = [
  "SOUL.md",
  "SHADOW.md",
  "STORY.md",
  "BONDS.md",
  "MORTAL.md",
  "GROWTH.md",
  "PRINCIPLES.md",
  "EDGES.md",
];

const PROTECTED_FILES = ["STATE.md", "FRAMEWORKS.md"];

export async function handleSoulWrite(
  fileName: string,
  content: string,
): Promise<string> {
  if (PROTECTED_FILES.includes(fileName)) {
    return `Error: ${fileName} is auto-managed by the soul system and cannot be written directly.`;
  }

  if (!WRITABLE_FILES.includes(fileName)) {
    return `Error: Unknown soul file "${fileName}". Writable files: ${WRITABLE_FILES.join(", ")}`;
  }

  await ensureDirs();
  const filePath = soulFilePath(fileName);
  await fs.writeFile(filePath, content, "utf-8");
  return `Successfully wrote ${fileName} (${content.length} chars)`;
}
