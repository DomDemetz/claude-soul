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

const server = new McpServer({
  name: "claude-soul",
  version: "0.1.0",
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Claude Soul MCP server failed to start:", err);
  process.exit(1);
});
