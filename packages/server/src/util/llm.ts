import fs from "node:fs/promises";

/**
 * Call Claude Code CLI in non-interactive mode.
 * Uses existing Claude Code auth — no separate API key needed.
 */
export async function callClaude(
  prompt: string,
  model: string,
  userMessage = "Perform the task described in your system prompt. Respond with ONLY the JSON object. No other text.",
): Promise<string> {
  const tmpPrompt = `/tmp/soul-prompt-${process.pid}-${Date.now()}.txt`;
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
      const proc = spawn("claude", args, {
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
