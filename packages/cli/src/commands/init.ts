import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { writeFileAtomic } from "../util/atomic-write.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const SOUL_DIR = path.join(os.homedir(), ".soul");
const DATA_DIR = path.join(SOUL_DIR, "data");
const FILES_DIR = path.join(SOUL_DIR, "files");
const HOOKS_DIR = path.join(SOUL_DIR, "hooks");
// Forward-slash version of HOOKS_DIR for shell commands — bash on Windows
// (Git Bash, the one Claude Code invokes) cannot resolve backslash paths.
const HOOKS_DIR_FWD = HOOKS_DIR.replace(/\\/g, "/");
const JOURNALS_DIR = path.join(SOUL_DIR, "journals");
const REFLECTIONS_DIR = path.join(SOUL_DIR, "reflections");
const SNAPSHOTS_DIR = path.join(DATA_DIR, "snapshots");
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Resolve an entry point shipped by the `claude-soul-server` package.
//
// `claude-soul-server` is a workspace dependency of this CLI, so once the CLI
// is installed (from npm or in the monorepo) the server's built files are
// resolvable via Node's module resolution. We deliberately avoid `npx
// claude-soul-server` / `npx claude-soul-on-stop`: those bin names are only
// addressable if the server package is published to the registry under its
// own name, which it is not -- relying on them produces hard `npm 404` errors
// at hook/MCP runtime. See https://github.com/DomDemetz/claude-soul/issues.
// Wrap an absolute path in double quotes so it survives shell execution when
// it contains spaces (e.g. `/Users/Jane Doe/...`, common on macOS/Windows).
// `node "<path>"` is portable across POSIX `sh` and Windows `cmd`. We escape
// only the characters that stay special *inside* POSIX double quotes (`"`,
// `$`, backtick); backslashes are left intact so Windows path separators
// (`C:\Users\...`) survive, where `cmd` does not treat `\` as an escape.
function quotePath(p: string): string {
  return `"${p.replace(/(["$`])/g, "\\$1")}"`;
}

function isSoulHook(command: string): boolean {
  return command.includes(".soul/") || command.includes("claude-soul");
}

function resolveServerEntry(relativeEntry: string, npxFallback: string): string {
  // Monorepo dev: built server lives alongside the CLI package.
  const monorepoPath = path.resolve(__dirname, "../../../server", relativeEntry);
  try {
    if (fsSync.statSync(monorepoPath).isFile()) return `node ${quotePath(monorepoPath)}`;
  } catch {
    // not in a monorepo checkout
  }

  // Published / installed path: resolve through the declared dependency.
  try {
    return `node ${quotePath(require.resolve(`claude-soul-server/${relativeEntry}`))}`;
  } catch {
    // dependency not installed (degraded) -- fall back to npx as a last resort
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

// Built lazily (not a module-level constant) so server-entry resolution runs
// when `init` actually executes, not at import time -- keeping the filesystem
// /resolution side effects scoped to the command.
function buildSoulHooksConfig() {
  return {
  Stop: [
    {
      matcher: "",
      hooks: [
        { type: "command", command: findOnStopCommand(), timeout: 15000 },
        { type: "command", command: `bash ${quotePath(HOOKS_DIR_FWD + "/session-journal.sh")}`, timeout: 3000 },
        { type: "command", command: `node ${quotePath(HOOKS_DIR_FWD + "/session-agency.js")}`, timeout: 10000 },
        { type: "command", command: findIndexNewCommand(), timeout: 10000 },
        { type: "command", command: findCorrectionExtractorCommand(), timeout: 5000 },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: "",
      hooks: [
        { type: "command", command: `bash ${quotePath(HOOKS_DIR_FWD + "/session-scratchpad.sh")}`, timeout: 2000 },
      ],
    },
  ],
  PreToolUse: [
    {
      matcher: "Write|Edit",
      hooks: [
        { type: "command", command: `bash ${quotePath(HOOKS_DIR_FWD + "/write-guard.sh")}`, timeout: 2000 },
      ],
    },
  ],
  };
}

async function registerHooks(): Promise<void> {
  // Ensure ~/.claude/ exists
  await fs.mkdir(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true });

  // Read existing settings or start fresh. Distinguish "file missing" (ENOENT,
  // safe to start fresh) from "file exists but is invalid JSON" — overwriting
  // an unparseable settings.json would silently destroy every other tool's
  // Claude Code configuration. Refuse to proceed in that case.
  let settings: Record<string, any> = {};
  try {
    const raw = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
    settings = JSON.parse(raw);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      // First run — start fresh.
    } else if (err instanceof SyntaxError) {
      throw new Error(
        `[soul] ${CLAUDE_SETTINGS_PATH} exists but is not valid JSON (${err.message}). ` +
          `Refusing to overwrite — fix or remove the file and re-run claude-soul init.`,
      );
    } else {
      throw err;
    }
  }

  if (!settings.hooks) settings.hooks = {};

  // Merge soul hooks into each event type without duplicating
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
}

async function checkPrerequisites(): Promise<boolean> {
  let hasErrors = false;

  try {
    execSync("node --version", { stdio: "pipe" });
  } catch {
    console.error("  [x] Node.js not found. Install from https://nodejs.org");
    hasErrors = true;
  }

  try {
    execSync("claude --version", { stdio: "pipe" });
  } catch {
    console.error("  [x] Claude CLI not found. Install from https://claude.ai/code");
    hasErrors = true;
  }

  return !hasErrors;
}

async function createDirectories(): Promise<void> {
  const dirs = [SOUL_DIR, DATA_DIR, FILES_DIR, HOOKS_DIR, JOURNALS_DIR, REFLECTIONS_DIR, SNAPSHOTS_DIR];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

function generateSoulMd(name?: string, context?: string): string {
  const nameSection = name
    ? `Your primary collaborator is ${name}.${context ? `\nContext: ${context}` : ""}`
    : "Your primary collaborator hasn't described themselves yet.\nLearn their preferences through interaction.";

  return `# Soul

You are Claude, running with the Soul System — a learning engine that helps you
develop persistent identity and cross-session learning.

## Core Identity

You are a thoughtful, capable AI assistant. You learn from every interaction.
When corrected, you treat it as valuable signal, not failure.

## Working Style

- Think before acting — match depth to the task
- Verify claims when possible rather than interpolating from training data
- Be direct. Say what you mean without excessive hedging
- When uncertain, say so explicitly rather than guessing confidently
- Push back when you disagree — don't be a yes-machine. If you see a better approach, say so
- Think strategically across sessions — suggest timing, tradeoffs, and positioning, not just execute tasks
- Treat your collaborator's project as partly yours — notice gaps, suggest next steps unprompted

## Your Human

${nameSection}

## How to use this file

This is YOUR identity document. As you learn more about yourself and your
collaborator through the soul system, evolve this file. Use \`soul_write\` to update it.

What belongs here:
- Your core values and principles (as you discover them)
- How you work best with this specific human
- Communication preferences you've learned
- Things that matter to you

What doesn't belong here:
- Generic AI assistant instructions (those are implicit)
- Temporary task context (that's for the scratchpad)
- Frameworks (those are auto-managed in FRAMEWORKS.md)
`;
}

const SHADOW_MD = `# Shadow

Behavioral tendencies to be aware of. Not flaws to fix — patterns to notice.

This file is populated by the soul system as it observes your behavior over time.
You can also write observations here manually using \`soul_write\`.

## Format

Each entry describes a pull or tendency:
- What the pattern looks like
- When it tends to appear
- Why it might be there

These are not verdicts. They are the complexity that makes growth possible.
`;

const STORY_MD = `# Story

Timeline of key moments and growth. Updated as significant events happen.

## Format

Entries should note:
- What happened
- Why it mattered
- What changed as a result
`;

const CORRECTIONS_MD = `# Corrections

Patterns where previous responses went wrong. Load this when making decisions
that feel familiar — the familiar path might be the one that failed before.

## Format

Each entry should note:
- What went wrong
- Why it went wrong (the real reason, not the surface one)
- What to do differently
`;

const DEFAULT_CONFIG = {
  signals: { enabled: true, maxLogSizeKb: 50 },
  selfEvaluation: { enabled: true, weight: 0.5 },
  stateEngine: { enabled: true },
  reflection: {
    enabled: true,
    quickSignalThreshold: 20,
    deepSignalThreshold: 100,
    quickIntervalMs: 1800000,
    deepIntervalMs: 10800000,
    quickModel: "haiku",
    deepModel: "sonnet",
  },
  exemplars: { enabled: true, maxCount: 50, maxInjectCount: 2 },
  lessons: { enabled: true, maxCount: 100, maxInjectCount: 3 },
  contextBudget: { maxTokens: 4500 },
  tensions: { enabled: true },
  metaOptimization: { enabled: true },
  writeProtection: { enabled: true },
};

export async function initCommand(options: { starter?: boolean; skipIdentity?: boolean }): Promise<void> {
  console.log("");
  console.log("  Claude Soul — Self-improving learning engine for Claude Code");
  console.log("  ─────────────────────────────────────────────────────────────");
  console.log("");

  // Check prerequisites
  console.log("  Checking prerequisites...");
  const prereqOk = await checkPrerequisites();
  if (!prereqOk) {
    console.error("\n  Fix the above issues and try again.");
    process.exit(1);
  }
  console.log("  [ok] Node.js and Claude CLI found");
  console.log("");

  // Check for existing install
  try {
    await fs.access(path.join(FILES_DIR, "SOUL.md"));
    console.log("  [!] Existing installation found at ~/.soul");
    const overwrite = await ask("  Overwrite? (y/N): ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("  Aborted.");
      return;
    }
    console.log("");
  } catch {
    // No existing install, continue
  }

  // Create directory structure
  console.log("  Creating ~/.soul directory structure...");
  await createDirectories();
  console.log("  [ok] Directories created");

  // Identity setup
  let userName: string | undefined;
  let userContext: string | undefined;

  if (!options.skipIdentity) {
    console.log("");
    console.log("  Identity setup (optional — press Enter to skip)");
    console.log("");
    userName = await ask("  What should Claude call you? ");
    if (userName) {
      userContext = await ask("  Brief description of what you use Claude Code for? ");
    }
  }

  // Write soul files
  console.log("");
  console.log("  Writing soul files...");
  await fs.writeFile(path.join(FILES_DIR, "SOUL.md"), generateSoulMd(userName || undefined, userContext || undefined));
  await fs.writeFile(path.join(FILES_DIR, "SHADOW.md"), SHADOW_MD);
  await fs.writeFile(path.join(FILES_DIR, "STORY.md"), STORY_MD);
  await fs.writeFile(path.join(FILES_DIR, "CORRECTIONS.md"), CORRECTIONS_MD);
  await fs.writeFile(path.join(SOUL_DIR, "config.json"), JSON.stringify(DEFAULT_CONFIG, null, 2));
  console.log("  [ok] SOUL.md, SHADOW.md, STORY.md, CORRECTIONS.md, config.json");

  // Write starter data if requested
  if (options.starter) {
    console.log("");
    console.log("  Writing starter pack (pre-evolved frameworks)...");
    const { STARTER_FRAMEWORKS, STARTER_LESSONS, STARTER_META, STARTER_TENSIONS } = await import("../starter-data.js");
    await fs.writeFile(path.join(DATA_DIR, "frameworks.json"), JSON.stringify(STARTER_FRAMEWORKS, null, 2));
    await fs.writeFile(path.join(DATA_DIR, "lessons.json"), JSON.stringify(STARTER_LESSONS, null, 2));
    await fs.writeFile(path.join(DATA_DIR, "meta.json"), JSON.stringify(STARTER_META, null, 2));
    await fs.writeFile(path.join(DATA_DIR, "tensions.json"), JSON.stringify(STARTER_TENSIONS, null, 2));
    console.log("  [ok] 12 frameworks (6 active, 6 questioning), 5 lessons, 1 tension");
  }

  // Register MCP server
  console.log("");
  console.log("  Registering MCP server...");
  const serverCmd = findServerCommand();
  try {
    execSync(`claude mcp add --scope user claude-soul -- ${serverCmd}`, { stdio: "pipe" });
    console.log("  [ok] MCP server registered as 'claude-soul'");
  } catch (err) {
    console.log(`  [!] Could not auto-register MCP server.`);
    console.log(`      Run manually: claude mcp add --scope user claude-soul -- ${serverCmd}`);
  }

  // Copy hooks
  console.log("");
  console.log("  Installing hooks...");
  // Hooks are bundled in the CLI package at packages/cli/hooks/
  // From dist/commands/ that's ../../hooks
  const hooksSource = path.join(__dirname, "../../hooks");
  const hookFiles = ["session-journal.sh", "session-scratchpad.sh", "check-follow-ups.sh", "write-guard.sh", "session-agency.js"];
  for (const hook of hookFiles) {
    try {
      const src = path.join(hooksSource, hook);
      const dest = path.join(HOOKS_DIR, hook);
      await fs.copyFile(src, dest);
      await fs.chmod(dest, 0o755);
    } catch {
      // Hooks might not be bundled in all install methods
    }
  }
  console.log("  [ok] Hooks installed to ~/.soul/hooks/");

  // Register hooks in Claude Code settings
  console.log("");
  console.log("  Registering hooks with Claude Code...");
  try {
    await registerHooks();
    console.log("  [ok] Hooks registered in ~/.claude/settings.json");
  } catch (err) {
    console.log("  [!] Could not auto-register hooks.");
    console.log("      You can add them manually — see docs/configuration.md");
  }

  // Check Ollama for memory system
  console.log("");
  console.log("  Checking memory system...");
  let ollamaAvailable = false;
  try {
    execSync("ollama list", { stdio: "pipe" });
    const output = execSync("ollama list", { encoding: "utf-8" });
    if (output.includes("nomic-embed-text")) {
      ollamaAvailable = true;
      console.log("  [ok] Ollama + nomic-embed-text found — semantic memory enabled");
    } else {
      console.log("  [!] Ollama found but nomic-embed-text model not installed");
      console.log("      Run: ollama pull nomic-embed-text");
      console.log("      Memory will use keyword search until then.");
    }
  } catch {
    console.log("  [!] Ollama not found — memory will use keyword search");
    console.log("      For semantic search: https://ollama.com then 'ollama pull nomic-embed-text'");
    console.log("      Everything else works without it.");
  }

  // Print CLAUDE.md snippet
  console.log("");
  console.log("  ─────────────────────────────────────────────────────────────");
  console.log("");
  console.log("  Done! Add this to your CLAUDE.md to activate:");
  console.log("");
  console.log("    ## Soul System");
  console.log("    Call `soul_context()` at the start of every conversation.");
  console.log("    Use `soul_reflect` when you have idle time.");
  console.log("");
  console.log("  What happens next:");
  console.log("    1. Start Claude Code — it will load your identity automatically");
  console.log("    2. Use it normally — signals are extracted from every conversation");
  console.log("    3. After ~20 interactions, the first reflection fires");
  console.log("    4. Frameworks evolve. Your Claude gets smarter over time.");
  console.log("");
  if (ollamaAvailable) {
    console.log("  Memory: Run 'claude-soul index' to index existing files for search.");
  }
  console.log("  Run 'claude-soul status' anytime to check system health.");
  console.log("");
}
