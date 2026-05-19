#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { handleSoulContext } from "./tools/soul-context.js";
import { handleSoulSignal } from "./tools/soul-signal.js";
import { handleSoulRead } from "./tools/soul-read.js";
import { handleSoulWrite } from "./tools/soul-write.js";
import { handleSoulStatus } from "./tools/soul-status.js";
import { handleSoulReflect } from "./tools/soul-reflect.js";
import { handleSoulEvaluate } from "./tools/soul-evaluate.js";
import { handleSoulActivate } from "./tools/soul-activate.js";
import { handleSoulFramework } from "./tools/soul-framework.js";
import { handleMemorySearch } from "./tools/memory-search.js";
import { handleMemorySave } from "./tools/memory-save.js";
import { handleMemoryJournal } from "./tools/memory-journal.js";
import { handleMemoryRecent } from "./tools/memory-recent.js";
import { handleMemoryStats } from "./tools/memory-stats.js";
import { handleRecall } from "./tools/recall.js";
import { closeDb } from "./memory/db.js";

const server = new McpServer({
  name: "claude-soul",
  version: "0.2.1",
});

server.tool(
  "soul_context",
  "Load your soul context — identity, frameworks, signals, lessons, and state. Call this at the start of every conversation. Default is 'full' (~4500 tokens). Use 'slim' for identity only.",
  {
    mode: z.enum(["slim", "full"]).optional()
      .describe("Context mode: 'full' (default) = identity + frameworks + signals + lessons + state. 'slim' = identity only."),
  },
  async ({ mode }) => {
    try {
      const context = await handleSoulContext(mode ?? "full");
      return { content: [{ type: "text", text: context }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error loading soul context: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "soul_activate",
  "Select and load relevant frameworks for this conversation. Call after reading the user's first message to pick the most applicable frameworks.",
  {
    message: z.string().describe("The user's first message or a summary of the conversation topic"),
  },
  async ({ message }) => {
    try {
      const result = await handleSoulActivate(message);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error activating frameworks: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "soul_framework",
  "Load a single framework with full details: description, evidence history, tier, and relationships.",
  {
    name: z.string().describe("Framework name (case-insensitive, partial match) or ID"),
  },
  async ({ name }) => {
    try {
      const result = await handleSoulFramework(name);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error loading framework: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "soul_signal",
  "Record observed signals from this interaction. Use when you notice patterns the automatic extractor might miss.",
  {
    signals: z
      .array(
        z.object({
          type: z.enum([
            "correction",
            "rephrasing",
            "gratitude",
            "disengagement",
            "topic_shift",
            "depth_change",
            "success",
            "confusion",
          ]),
          evidence: z.string().describe("What you observed"),
          confidence: z.number().min(0).max(1).optional(),
        }),
      )
      .describe("Array of observed signals"),
  },
  async ({ signals }) => {
    try {
      const result = await handleSoulSignal(signals);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error recording signals: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "soul_read",
  "Read a soul file. Available: SOUL.md, SHADOW.md, STATE.md, STORY.md, CORRECTIONS.md, FRAMEWORKS.md, BONDS.md, MORTAL.md, GROWTH.md, PRINCIPLES.md, EDGES.md",
  {
    file: z.string().describe("Soul file name (e.g., SOUL.md)"),
  },
  async ({ file }) => {
    try {
      const content = await handleSoulRead(file);
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error reading soul file: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "soul_write",
  "Write to a soul file. SOUL.md, SHADOW.md, STORY.md, CORRECTIONS.md, BONDS.md, MORTAL.md, GROWTH.md, PRINCIPLES.md, EDGES.md are writable. STATE.md and FRAMEWORKS.md are auto-managed.",
  {
    file: z.string().describe("Soul file name (e.g., SOUL.md)"),
    content: z.string().describe("New content for the file"),
  },
  async ({ file, content }) => {
    try {
      const result = await handleSoulWrite(file, content);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error writing soul file: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "soul_status",
  "Get current system status — framework count, learning phase, signal count, last reflection time.",
  {},
  async () => {
    try {
      const status = await handleSoulStatus();
      return { content: [{ type: "text", text: status }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error getting status: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "soul_reflect",
  "Trigger a reflection cycle. Quick: tests frameworks against recent signals. Deep: full analysis with framework discovery. Meta: audits framework coherence and redundancy.",
  {
    tier: z
      .enum(["quick", "deep", "meta"])
      .describe("Reflection tier: quick (fast, signal testing), deep (thorough, discovers new frameworks), meta (audits the system itself)"),
  },
  async ({ tier }) => {
    try {
      const result = await handleSoulReflect(tier);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error during reflection: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "soul_self_evaluate",
  "Record a self-evaluation of a complex response. Be descriptive: 'Response used 450 words for a simple question' not 'bad response'.",
  {
    summary: z
      .string()
      .describe("Brief descriptive summary of the response and its dynamics"),
  },
  async ({ summary }) => {
    try {
      const result = await handleSoulEvaluate(summary);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error during self-evaluation: ${err}` }],
        isError: true,
      };
    }
  },
);

// --- Memory tools ---

server.tool(
  "memory_search",
  "Semantic search across all memories and journal entries. Returns results ranked by meaning-similarity. Falls back to keyword search if Ollama is not available.",
  {
    query: z.string().describe("What to search for (natural language)"),
    category: z
      .enum(["decision", "preference", "fact", "episode", "lesson", "architecture", "framework", "general"])
      .optional()
      .describe("Filter by category"),
    project: z.string().optional().describe("Filter by project name"),
    topK: z.number().optional().describe("Number of results (default: 5)"),
  },
  async ({ query, category, project, topK }) => {
    try {
      const result = await handleMemorySearch(query, { category, project, topK });
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error searching memories: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "memory_save",
  "Save a fact, decision, preference, or lesson to long-term memory. Automatically generates an embedding for future semantic search.",
  {
    content: z.string().describe("The memory content — be specific and self-contained"),
    category: z
      .enum(["decision", "preference", "fact", "episode", "lesson", "architecture", "framework", "general"])
      .optional()
      .describe("Memory category (default: general)"),
    project: z.string().optional().describe("Associated project name"),
  },
  async ({ content, category, project }) => {
    try {
      const result = await handleMemorySave(content, category, project);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error saving memory: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "memory_journal",
  "Search or browse the conversation journal. Use to answer 'what did I work on?' or find past conversations by topic.",
  {
    query: z.string().optional().describe("Search query (semantic). Omit to list recent entries."),
    days: z.number().optional().describe("How many days back to look (default: 7)"),
  },
  async ({ query, days }) => {
    try {
      const result = await handleMemoryJournal(query, days);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error reading journal: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "memory_recent",
  "List recently saved memories. Use for a quick overview of what's been recorded.",
  {
    days: z.number().optional().describe("How many days back (default: 7)"),
    project: z.string().optional().describe("Filter by project name"),
  },
  async ({ days, project }) => {
    try {
      const result = await handleMemoryRecent(days, project);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error listing memories: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "memory_stats",
  "Show memory system statistics — counts by category, project, most accessed, and recent searches.",
  {},
  async () => {
    try {
      const result = await handleMemoryStats();
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error getting stats: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "recall",
  "Unified search across ALL memory — facts, decisions, frameworks, lessons, and past conversations. Returns categorized results. Use this as the default 'ask anything about the past' tool.",
  {
    query: z.string().describe("What to recall (natural language)"),
  },
  async ({ query }) => {
    try {
      const result = await handleRecall(query);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error recalling: ${err}` }],
        isError: true,
      };
    }
  },
);

// Cleanup on exit
process.on("SIGINT", () => {
  closeDb();
  process.exit(0);
});
process.on("SIGTERM", () => {
  closeDb();
  process.exit(0);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Claude Soul MCP server failed to start:", err);
  process.exit(1);
});
