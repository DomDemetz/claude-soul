import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const SOUL_DIR = path.join(os.homedir(), ".soul");
const DATA_DIR = path.join(SOUL_DIR, "data");
const FILES_DIR = path.join(SOUL_DIR, "files");

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function resetCommand(options: { hard?: boolean }): Promise<void> {
  console.log("");

  if (options.hard) {
    console.log("  Hard reset will delete ALL soul data including your identity (SOUL.md).");
  } else {
    console.log("  Soft reset will clear learning data but keep your identity (SOUL.md, SHADOW.md, etc.).");
  }

  const confirm = await ask("  Are you sure? (y/N): ");
  if (confirm.toLowerCase() !== "y") {
    console.log("  Aborted.");
    return;
  }

  // Always clear data files
  const dataFiles = [
    "frameworks.json",
    "session-log.jsonl",
    "state.json",
    "tensions.json",
    "exemplars.json",
    "lessons.json",
    "meta.json",
    "follow-ups.json",
    "agency-log.json",
  ];

  for (const file of dataFiles) {
    try {
      await fs.unlink(path.join(DATA_DIR, file));
    } catch {
      // File might not exist
    }
  }

  // Clear snapshots
  try {
    const snapshots = await fs.readdir(path.join(DATA_DIR, "snapshots"));
    for (const file of snapshots) {
      await fs.unlink(path.join(DATA_DIR, "snapshots", file));
    }
  } catch {
    // Directory might not exist
  }

  // Clear auto-managed files
  try {
    await fs.unlink(path.join(FILES_DIR, "STATE.md"));
    await fs.unlink(path.join(FILES_DIR, "FRAMEWORKS.md"));
  } catch {
    // Files might not exist
  }

  if (options.hard) {
    // Also clear user-writable files
    const userFiles = ["SOUL.md", "SHADOW.md", "STORY.md", "CORRECTIONS.md", "BONDS.md", "MORTAL.md", "GROWTH.md", "PRINCIPLES.md", "EDGES.md"];
    for (const file of userFiles) {
      try {
        await fs.unlink(path.join(FILES_DIR, file));
      } catch {
        // File might not exist
      }
    }
  }

  console.log("");
  console.log(options.hard
    ? "  Hard reset complete. Run 'claude-soul init' to set up again."
    : "  Soft reset complete. Learning data cleared. Identity preserved. Next session starts fresh.");
  console.log("");
}
