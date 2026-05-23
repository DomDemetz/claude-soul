import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { writeFileAtomic } from "../util/atomic-write.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const SOUL_DIR = path.join(os.homedir(), ".soul");
const HOOKS_DIR = path.join(SOUL_DIR, "hooks");
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

// Forward-slash version of HOOKS_DIR for use in shell commands (bash requires / on Windows too)
const HOOKS_DIR_FWD = HOOKS_DIR.replace(/\\/g, "/");

function quotePath(p: string): string {
  return `"${p.replace(/(["$`])/g, "\\$1")}"`;
}

function isSoulHook(command: string): boolean {
  return command.includes(".soul/") || command.includes("claude-soul");
}

function resolveServerEntry(relativeEntry: string, npxFallback: string): string {
  const monorepoPath = path.resolve(__dirname, "../../../server", relativeEntry);
  try {
    if (fsSync.statSync(monorepoPath).isFile()) return `node ${quotePath(monorepoPath)}`;
  } catch {
    /* not in monorepo */
  }
  try {
    return `node ${quotePath(require.resolve(`claude-soul-server/${relativeEntry}`))}`;
  } catch {
    /* not installed */
  }
  return npxFallback;
}

function findServerCommand(): string {
  return resolveServerEntry("dist/index.js", "npx claude-soul-server");
}

function findOnStopCommand(): string {
  return resolveServerEntry("dist/hooks/on-stop.js", "npx claude-soul-on-stop");
}

function findIndexNewCommand(): string {
  return resolveServerEntry("dist/cli/index-new.js", "npx claude-soul-index-new");
}

function findCorrectionExtractorCommand(): string {
  return resolveServerEntry("dist/hooks/correction-extractor.js", "npx claude-soul-extract-corrections");
}

function buildSoulHooksConfig() {
  return {
    Stop: [
      {
        matcher: "",
        hooks: [
          { type: "command", command: findOnStopCommand(), timeout: 15000 },
          { type: "command", command: `bash ${HOOKS_DIR_FWD}/session-journal.sh`, timeout: 3000 },
          { type: "command", command: `node ${HOOKS_DIR_FWD}/session-agency.js`, timeout: 10000 },
          { type: "command", command: findIndexNewCommand(), timeout: 10000 },
          { type: "command", command: findCorrectionExtractorCommand(), timeout: 5000 },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "",
        hooks: [
          { type: "command", command: `bash ${HOOKS_DIR_FWD}/session-scratchpad.sh`, timeout: 2000 },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Write|Edit",
        hooks: [
          { type: "command", command: `bash ${HOOKS_DIR_FWD}/write-guard.sh`, timeout: 2000 },
        ],
      },
    ],
  };
}

export async function upgradeCommand(): Promise<void> {
  console.log("");
  console.log("  Claude Soul — Upgrade");
  console.log("  ─────────────────────");
  console.log("");

  try {
    await fs.access(SOUL_DIR);
  } catch {
    console.log("  No existing installation found. Run 'claude-soul init' first.");
    return;
  }

  // Update hooks
  console.log("  Updating hooks...");
  const hooksSource = path.join(__dirname, "../../hooks");
  const hookFiles = ["session-journal.sh", "session-scratchpad.sh", "check-follow-ups.sh", "write-guard.sh", "session-agency.js"];
  let hooksUpdated = 0;
  for (const hook of hookFiles) {
    try {
      const src = path.join(hooksSource, hook);
      const dest = path.join(HOOKS_DIR, hook);
      await fs.copyFile(src, dest);
      await fs.chmod(dest, 0o755);
      hooksUpdated++;
    } catch {
      // Hook not in bundle
    }
  }
  console.log(`  [ok] ${hooksUpdated} hook scripts updated`);

  // Re-register hooks in settings.json
  console.log("");
  console.log("  Re-registering hooks with Claude Code...");
  let settings: Record<string, any> = {};
  try {
    const raw = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
    settings = JSON.parse(raw);
  } catch {
    // No settings
  }

  if (!settings.hooks) settings.hooks = {};

  for (const [event, entries] of Object.entries(buildSoulHooksConfig())) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = entries;
    } else {
      for (const group of settings.hooks[event]) {
        if (group.hooks) {
          group.hooks = group.hooks.filter((h: any) => !isSoulHook(h.command));
        }
      }
      settings.hooks[event] = settings.hooks[event].filter(
        (g: any) => !g.hooks || g.hooks.length > 0,
      );
      for (const entry of entries as any[]) {
        const matchingGroup = settings.hooks[event].find((e: any) => e.matcher === entry.matcher);
        if (matchingGroup) {
          matchingGroup.hooks.push(...entry.hooks);
        } else {
          settings.hooks[event].push(entry);
        }
      }
    }
  }

  await writeFileAtomic(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  console.log("  [ok] Hooks registered (new hooks added, existing kept)");

  // Re-register MCP server
  console.log("");
  console.log("  Updating MCP server registration...");
  const serverCmd = findServerCommand();
  try {
    execSync(`claude mcp add --scope user claude-soul -- ${serverCmd}`, { stdio: "pipe" });
    console.log("  [ok] MCP server updated");
  } catch {
    console.log(`  [!] Could not auto-register. Run: claude mcp add --scope user claude-soul -- ${serverCmd}`);
  }

  // Check Ollama
  console.log("");
  try {
    const output = execSync("ollama list", { encoding: "utf-8", stdio: "pipe" });
    if (output.includes("nomic-embed-text")) {
      console.log("  [ok] Ollama + nomic-embed-text available — semantic memory enabled");
    } else {
      console.log("  [!] Ollama found but missing nomic-embed-text. Run: ollama pull nomic-embed-text");
    }
  } catch {
    console.log("  [i] Ollama not installed — memory uses keyword search (still works fine)");
  }

  console.log("");
  console.log("  ─────────────────────");
  console.log("");
  console.log("  Upgrade complete. Your soul files and data are untouched.");
  console.log("");
  console.log("  What's new in v0.2:");
  console.log("    - Correction tracking: auto-detects when you correct your Claude");
  console.log("    - Shadow analysis: 'claude-soul shadow' shows behavioral patterns");
  console.log("    - Memory system: 6 new MCP tools for long-term memory");
  console.log("    - Run 'claude-soul index' to index existing data into memory");
  console.log("");
}
