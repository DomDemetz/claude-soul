import { execSync } from "node:child_process";
import path from "node:path";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

function resolveIndexer(): string {
  // Monorepo dev
  const monorepoPath = path.resolve(__dirname, "../../../server/dist/cli/index-sources.js");
  if (fsSync.existsSync(monorepoPath)) return monorepoPath;

  // Published / installed
  try {
    return require.resolve("claude-soul-server/dist/cli/index-sources.js");
  } catch {
    // not found
  }

  throw new Error("Could not find index-sources.js — is claude-soul-server installed?");
}

export async function indexCommand(): Promise<void> {
  console.log("");
  console.log("  Claude Soul — Memory Indexer");
  console.log("  ────────────────────────────");
  console.log("");

  try {
    const indexerPath = resolveIndexer();
    execSync(`node "${indexerPath}"`, { stdio: "inherit" });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Could not find")) {
      console.error(`  [x] ${err.message}`);
      process.exit(1);
    }
    // execSync throws on non-zero exit — the indexer already printed its error
    process.exit(1);
  }
}
