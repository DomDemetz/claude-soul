#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { resetCommand } from "./commands/reset.js";
import { shadowCommand } from "./commands/shadow.js";
import { indexCommand } from "./commands/index-cmd.js";
import { upgradeCommand } from "./commands/upgrade.js";

const program = new Command();

program
  .name("claude-soul")
  .description("Give Claude Code a soul — persistent identity, cross-session learning, and evolving cognitive frameworks")
  .version("0.2.1");

program
  .command("init")
  .description("Set up Claude Soul — creates ~/.soul, registers MCP server, configures hooks")
  .option("--starter", "Include pre-evolved starter frameworks for immediate value")
  .option("--skip-identity", "Skip the identity setup questions")
  .action(initCommand);

program
  .command("status")
  .description("Show current soul system status")
  .action(statusCommand);

program
  .command("reset")
  .description("Reset learning data (keeps SOUL.md identity)")
  .option("--hard", "Also reset SOUL.md and all soul files")
  .action(resetCommand);

program
  .command("index")
  .description("Index existing soul files, journals, lessons, and frameworks into the memory database")
  .action(indexCommand);

program
  .command("upgrade")
  .description("Update hooks and MCP server without touching your soul files or data")
  .action(upgradeCommand);

program
  .command("shadow")
  .description("Analyze behavioral correction patterns and track growth")
  .option("--brief", "Show one-line summary per pattern")
  .option("--generate", "Generate a SHADOW.md from your correction data")
  .action(shadowCommand);

program.parse();
