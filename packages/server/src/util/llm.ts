import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Resolve the Claude Code CLI executable.
 *
 * `callClaude` spawns the CLI without a shell. On Windows that cannot run the
 * `claude.cmd` shim npm places on PATH, and npm never puts a bare `claude.exe`
 * on PATH at all — the real executable lives at
 * `@anthropic-ai/claude-code/bin/claude.exe`. So a plain `spawn("claude")`
 * fails with `spawn claude ENOENT`.
 *
 * Scanning PATH alone is unreliable too: the soul MCP server is a child
 * process whose PATH may not include the npm global bin dir. So we first walk
 * up from this module — `@anthropic-ai/claude-code` is normally co-installed
 * in an ancestor `node_modules` — and only then fall back to scanning PATH.
 *
 * No-op on POSIX, where `spawn("claude")` resolves the CLI normally.
 */
function resolveClaudeBin(): string {
  if (process.platform !== "win32") return "claude";

  const exeRelative = path.join(
    "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe",
  );

  // 1. Walk up from this module — PATH- and npm-prefix-independent.
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 12; depth++) {
    const exe = path.join(dir, exeRelative);
    if (existsSync(exe)) return exe;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }

  // 2. Fall back to scanning PATH (covers native-installer / non-npm layouts).
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!entry) continue;
    const viaNodeModules = path.join(entry, exeRelative);
    if (existsSync(viaNodeModules)) return viaNodeModules;
    const direct = path.join(entry, "claude.exe");
    if (existsSync(direct)) return direct;
  }

  return "claude";
}

/**
 * Call Claude Code CLI in non-interactive mode.
 * Uses existing Claude Code auth — no separate API key needed.
 */
export async function callClaude(
  prompt: string,
  model: string,
  userMessage = "Perform the task described in your system prompt. Respond with ONLY the JSON object. No other text.",
): Promise<string> {
  const tmpPrompt = path.join(os.tmpdir(), `soul-prompt-${process.pid}-${Date.now()}.txt`);
  await fs.writeFile(tmpPrompt, prompt, "utf-8");

  const args = [
    "-p", userMessage,
    "--append-system-prompt-file", tmpPrompt,
    "--model", model,
    "--max-turns", "3",
    "--output-format", "text",
    "--no-session-persistence",
  ];

  try {
    const { spawn } = await import("node:child_process");
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn(resolveClaudeBin(), args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1" },
      });

      proc.stdin.end();

      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error("claude CLI timed out after 8 minutes"));
      }, 480_000);

      proc.on("close", (code) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(chunks).toString("utf-8");
        const stderr = Buffer.concat(errChunks).toString("utf-8");
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    return result;
  } finally {
    await fs.unlink(tmpPrompt).catch(() => {});
  }
}

export function parseLlmJson(raw: string): Record<string, unknown> | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
