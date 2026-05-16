import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FrameworkEngine } from "../engine/framework-engine.js";
import { renderFrameworkSummary } from "../engine/framework-renderer.js";
import { StateEngine } from "../engine/state-engine.js";
import { getSignalCount } from "../engine/signal-store.js";
import { loadConfig } from "../util/files.js";
import { loadMeta, getReflectionThresholds } from "../engine/meta-optimizer.js";

async function checkHealth(): Promise<string[]> {
  const issues: string[] = [];
  const ok: string[] = [];

  // Check soul directory
  const soulDir = path.join(os.homedir(), ".soul");
  try {
    const files = await fs.readdir(path.join(soulDir, "files"));
    ok.push(`Soul files: ${files.length} files`);
  } catch {
    issues.push("~/.soul/files/ directory missing — run: node ~/soul-mcp-server/dist/setup.js");
  }

  // Check hooks format in settings.json
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    const hooks = settings.hooks;

    if (!hooks) {
      issues.push("No hooks configured — run: node ~/soul-mcp-server/dist/setup.js");
    } else {
      // Validate Stop hook format
      const stopHooks = hooks.Stop;
      if (!Array.isArray(stopHooks) || stopHooks.length === 0) {
        issues.push("Stop hook missing");
      } else {
        const first = stopHooks.find((h: Record<string, unknown>) => {
          const hooksArr = h.hooks as Array<Record<string, unknown>> | undefined;
          return hooksArr?.some((x) => typeof x.command === "string" && (x.command as string).includes("soul"));
        });
        if (!first) {
          issues.push("Stop hook exists but soul hook not found");
        } else if (!first.hooks || !Array.isArray(first.hooks)) {
          issues.push("Stop hook has WRONG FORMAT (missing hooks array) — run: node ~/soul-mcp-server/dist/setup.js");
        } else {
          ok.push("Stop hook: configured correctly");
        }
      }

      // Validate PreToolUse hook format
      const preHooks = hooks.PreToolUse;
      if (Array.isArray(preHooks)) {
        const soulPre = preHooks.find((h: Record<string, unknown>) => {
          const hooksArr = h.hooks as Array<Record<string, unknown>> | undefined;
          return hooksArr?.some((x) => typeof x.command === "string" && (x.command as string).includes("soul"));
        });
        if (soulPre && soulPre.hooks && Array.isArray(soulPre.hooks)) {
          ok.push("Write guard: configured correctly");
        } else if (soulPre) {
          issues.push("Write guard has WRONG FORMAT — run: node ~/soul-mcp-server/dist/setup.js");
        }
      }
    }
  } catch {
    issues.push("Cannot read ~/.claude/settings.json");
  }

  // Check MCP server build
  const serverPath = path.join(os.homedir(), "soul-mcp-server", "dist", "index.js");
  try {
    await fs.access(serverPath);
    ok.push("MCP server: built");
  } catch {
    issues.push("MCP server not built — run: cd ~/soul-mcp-server && npm run build");
  }

  const lines: string[] = [];
  if (issues.length > 0) {
    lines.push("### Issues");
    for (const issue of issues) {
      lines.push(`- ⚠ ${issue}`);
    }
  }
  lines.push("### Health");
  for (const item of ok) {
    lines.push(`- ✓ ${item}`);
  }
  if (issues.length === 0) {
    lines.push("- ✓ All systems healthy");
  }

  return lines;
}

export async function handleSoulStatus(): Promise<string> {
  const frameworkEngine = new FrameworkEngine();
  const store = await frameworkEngine.initialize();
  const frameworkSummary = renderFrameworkSummary(store);

  const stateEngine = new StateEngine();
  await stateEngine.load();
  const state = stateEngine.getState();

  const signalCount = await getSignalCount();
  const meta = await loadMeta();
  const thresholds = getReflectionThresholds(meta);

  const sections: string[] = [];

  sections.push("# Soul System Status\n");

  // Health check
  const healthLines = await checkHealth();
  sections.push(healthLines.join("\n") + "\n");

  sections.push(`## Frameworks\n${frameworkSummary}\n`);

  sections.push(
    `## Session Affect\n` +
      `- Confidence: ${state.confidence.toFixed(2)}\n` +
      `- Mood: ${state.mood.toFixed(2)}\n` +
      `- Curiosity: ${state.curiosity.toFixed(2)}\n` +
      `- Frustration: ${state.frustration.toFixed(2)}\n`,
  );

  sections.push(
    `## Signals & Reflection\n` +
      `- Phase: ${meta.phase}\n` +
      `- Accumulated signals: ${signalCount}\n` +
      `- Next quick reflection: ${thresholds.quickSignals} signals OR ${thresholds.quickTimeMs / 3600000}h\n` +
      `- Next deep reflection: ${thresholds.deepSignals} signals OR ${thresholds.deepTimeMs / 3600000}h\n` +
      `- Min signals for any reflection: ${thresholds.minSignals}\n`,
  );

  const timeSinceReflection = store.meta.lastReflectionAt > 0
    ? `${Math.round((Date.now() - store.meta.lastReflectionAt) / (1000 * 60))} minutes ago`
    : "never";

  sections.push(
    `## Reflection History\n` +
      `- Total reflections: ${store.meta.reflectionCount}\n` +
      `- Last reflection: ${timeSinceReflection}\n` +
      `- Frameworks discovered: ${store.meta.totalDiscovered}\n` +
      `- Frameworks retired: ${store.meta.totalRetired}\n`,
  );

  return sections.join("\n");
}
