import { soulFilePath, readFileSafe } from "../util/files.js";

const ALLOWED_FILES = [
  "SOUL.md",
  "SHADOW.md",
  "STATE.md",
  "STORY.md",
  "BONDS.md",
  "MORTAL.md",
  "GROWTH.md",
  "PRINCIPLES.md",
  "FRAMEWORKS.md",
  "EDGES.md",
];

export async function handleSoulRead(fileName: string): Promise<string> {
  if (!ALLOWED_FILES.includes(fileName)) {
    return `Error: Unknown soul file "${fileName}". Available files: ${ALLOWED_FILES.join(", ")}`;
  }

  const content = await readFileSafe(soulFilePath(fileName));
  if (!content.trim()) {
    return `${fileName} is empty or does not exist yet.`;
  }

  return content;
}
