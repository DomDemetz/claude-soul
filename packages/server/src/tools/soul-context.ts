import { assembleSoulContext, assembleSlimContext } from "../engine/context-assembler.js";
import { loadConfig, ensureDirs, soulFilePath, writeFileAtomic } from "../util/files.js";
import { FrameworkEngine } from "../engine/framework-engine.js";
import { renderFrameworksToMarkdown } from "../engine/framework-renderer.js";
import { StateEngine } from "../engine/state-engine.js";

export async function handleSoulContext(
  mode: "slim" | "full" = "full",
): Promise<string> {
  await ensureDirs();

  if (mode === "slim") {
    const context = await assembleSlimContext();
    if (!context.trim()) {
      return "Soul system initialized but no context files found yet. Soul files are at ~/.soul/files/";
    }
    return context;
  }

  const frameworkEngine = new FrameworkEngine();
  const store = await frameworkEngine.initialize();
  const frameworksMd = renderFrameworksToMarkdown(store);
  await writeFileAtomic(soulFilePath("FRAMEWORKS.md"), frameworksMd);

  const stateEngine = new StateEngine();
  await stateEngine.load();
  stateEngine.recordEvent({ type: "session_start" });
  await stateEngine.tick();

  const config = await loadConfig();
  const context = await assembleSoulContext(config);

  if (!context.trim()) {
    return "Soul system initialized but no context files found yet. Soul files are at ~/.soul/files/";
  }

  return context;
}
