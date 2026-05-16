#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { resetCommand } from "./commands/reset.js";

const program = new Command();

program
  .name("claude-soul")
  .description("Give Claude Code a soul — persistent identity, cross-session learning, and evolving cognitive frameworks")
  .version("0.1.4");

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

program.parse();
