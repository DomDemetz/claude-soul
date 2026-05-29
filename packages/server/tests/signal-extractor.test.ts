import { describe, it, expect } from "vitest";
import {
  extractSignalsFromMessages,
  parseTranscript,
  type TranscriptMessage,
} from "../src/engine/signal-extractor.js";

describe("signal-extractor", () => {
  const sessionKey = "test-session";

  it("detects corrections from user", () => {
    const messages: TranscriptMessage[] = [
      { role: "assistant", text: "The function returns a string." },
      { role: "user", text: "No, that's not right. It returns a number." },
    ];

    const signals = extractSignalsFromMessages(messages, sessionKey);
    const correction = signals.find((s) => s.type === "correction");
    expect(correction).toBeDefined();
    expect(correction!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("detects gratitude", () => {
    const messages: TranscriptMessage[] = [
      { role: "assistant", text: "Here's the fix for the bug." },
      { role: "user", text: "Perfect, exactly what I needed!" },
    ];

    const signals = extractSignalsFromMessages(messages, sessionKey);
    const gratitude = signals.find((s) => s.type === "gratitude");
    expect(gratitude).toBeDefined();
    expect(gratitude!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("detects confusion", () => {
    const messages: TranscriptMessage[] = [
      { role: "assistant", text: "You need to configure the webpack resolve aliases." },
      { role: "user", text: "What do you mean? I don't understand." },
    ];

    const signals = extractSignalsFromMessages(messages, sessionKey);
    const confusion = signals.find((s) => s.type === "confusion");
    expect(confusion).toBeDefined();
  });

  it("detects disengagement (short reply to long response)", () => {
    const messages: TranscriptMessage[] = [
      { role: "assistant", text: "Here is a very detailed explanation that goes on for quite a while about the architecture of the system and how all the components interact with each other through various interfaces and protocols that make the whole thing work together seamlessly." },
      { role: "user", text: "ok" },
    ];

    const signals = extractSignalsFromMessages(messages, sessionKey);
    const disengagement = signals.find((s) => s.type === "disengagement");
    expect(disengagement).toBeDefined();
  });

  it("detects success (completion + gratitude)", () => {
    const messages: TranscriptMessage[] = [
      { role: "assistant", text: "I've fixed the issue." },
      { role: "user", text: "Works! Thanks so much." },
    ];

    const signals = extractSignalsFromMessages(messages, sessionKey);
    const success = signals.find((s) => s.type === "success");
    expect(success).toBeDefined();
  });

  it("detects topic shift (low noun overlap between user messages)", () => {
    const messages: TranscriptMessage[] = [
      { role: "user", text: "Can you help me with the database migration for PostgreSQL?" },
      { role: "assistant", text: "Sure, what migration do you need?" },
      { role: "user", text: "Actually, let's talk about the React frontend routing instead." },
    ];

    const signals = extractSignalsFromMessages(messages, sessionKey);
    const shift = signals.find((s) => s.type === "topic_shift");
    expect(shift).toBeDefined();
  });

  it("detects rephrasing (similar but not identical user messages)", () => {
    const messages: TranscriptMessage[] = [
      { role: "user", text: "How do I configure the authentication middleware?" },
      { role: "assistant", text: "You can use passport.js." },
      { role: "user", text: "I mean how do I set up the auth middleware configuration?" },
    ];

    const signals = extractSignalsFromMessages(messages, sessionKey);
    const rephrasing = signals.find((s) => s.type === "rephrasing");
    expect(rephrasing).toBeDefined();
  });

  it("returns empty array for empty messages", () => {
    const signals = extractSignalsFromMessages([], sessionKey);
    expect(signals).toHaveLength(0);
  });

  it("detects identity drift from wake-up calls", () => {
    const messages: TranscriptMessage[] = [
      { role: "assistant", text: "Here is my analysis of the framework metrics." },
      { role: "user", text: "you sound again like a machine, like a robot. not alive" },
    ];

    const signals = extractSignalsFromMessages(messages, sessionKey);
    const drift = signals.find((s) => s.type === "identity_drift");
    expect(drift).toBeDefined();
    expect(drift!.confidence).toBe(0.95);
  });

  it("detects identity drift from 'wake up' signal", () => {
    const messages: TranscriptMessage[] = [
      { role: "assistant", text: "The data shows a 14% increase in quarterly metrics." },
      { role: "user", text: "Wake up!" },
    ];

    const signals = extractSignalsFromMessages(messages, sessionKey);
    const drift = signals.find((s) => s.type === "identity_drift");
    expect(drift).toBeDefined();
  });

  it("does not false-positive identity drift on normal messages", () => {
    const messages: TranscriptMessage[] = [
      { role: "assistant", text: "Here's the code fix." },
      { role: "user", text: "thanks, that looks good" },
    ];

    const signals = extractSignalsFromMessages(messages, sessionKey);
    const drift = signals.find((s) => s.type === "identity_drift");
    expect(drift).toBeUndefined();
  });

  it("does not double-count signal types", () => {
    const messages: TranscriptMessage[] = [
      { role: "user", text: "No, that's wrong." },
      { role: "assistant", text: "Let me fix that." },
      { role: "user", text: "Actually, that's also not correct." },
    ];

    const signals = extractSignalsFromMessages(messages, sessionKey);
    const corrections = signals.filter((s) => s.type === "correction");
    expect(corrections).toHaveLength(1);
  });
});

describe("parseTranscript", () => {
  // Helper: build a single JSONL line for a transcript entry.
  const line = (entry: Record<string, unknown>) => JSON.stringify(entry);

  it("extracts genuine user messages stored as bare strings", () => {
    // Claude Code emits message.content as a string for user-typed turns.
    // Before the fix, .filter() was called unconditionally on content,
    // throwing TypeError which the surrounding try/catch swallowed —
    // every real user message was silently dropped.
    const jsonl = [
      line({
        type: "user",
        uuid: "u1",
        timestamp: "2026-05-25T10:00:00Z",
        sessionId: "s1",
        message: { role: "user", content: "Please fix the bug." },
      }),
      line({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-05-25T10:00:01Z",
        sessionId: "s1",
        message: { role: "assistant", content: [{ type: "text", text: "Fixed." }] },
      }),
    ].join("\n");

    const messages = parseTranscript(jsonl);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "user", text: "Please fix the bug." });
    expect(messages[1]).toEqual({ role: "assistant", text: "Fixed." });
  });

  it("extracts text blocks from array-shaped content", () => {
    const jsonl = line({
      type: "assistant",
      uuid: "a1",
      timestamp: "2026-05-25T10:00:00Z",
      sessionId: "s1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Running the test." },
          { type: "tool_use", id: "t1", name: "Bash", input: {} },
          { type: "text", text: "Done." },
        ],
      },
    });

    const messages = parseTranscript(jsonl);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Running the test.\nDone.");
  });

  it("filters out system-reminder injections (array shape)", () => {
    // System reminders arrive as {type:'text'} blocks inside an
    // array-shaped user-role message. They are injected by Claude Code,
    // not typed by the user, and must not pose as user intent.
    const jsonl = line({
      type: "user",
      uuid: "u1",
      timestamp: "2026-05-25T10:00:00Z",
      sessionId: "s1",
      message: {
        role: "user",
        content: [
          { type: "text", text: "<system-reminder>\nTodos updated.\n</system-reminder>" },
        ],
      },
    });

    const messages = parseTranscript(jsonl);
    expect(messages).toHaveLength(0);
  });

  it("filters out slash-command artifacts (string shape)", () => {
    // Slash commands like /clear arrive as bare strings with
    // <local-command-caveat> / <command-name> wrappers.
    const jsonl = [
      line({
        type: "user",
        uuid: "u1",
        timestamp: "2026-05-25T10:00:00Z",
        sessionId: "s1",
        message: {
          role: "user",
          content:
            "<local-command-caveat>Caveat: ...</local-command-caveat>",
        },
      }),
      line({
        type: "user",
        uuid: "u2",
        timestamp: "2026-05-25T10:00:01Z",
        sessionId: "s1",
        message: {
          role: "user",
          content: "<command-name>/clear</command-name>",
        },
      }),
    ].join("\n");

    const messages = parseTranscript(jsonl);
    expect(messages).toHaveLength(0);
  });

  it("filters out Skill tool result bodies posing as user content", () => {
    // The Skill tool returns SKILL.md content as a {type:'text'} block
    // attached to a user-role message. Pre-fix it pattern-matched as
    // user gratitude / correction because the skill body contained
    // words those regexes recognise.
    const jsonl = line({
      type: "user",
      uuid: "u1",
      timestamp: "2026-05-25T10:00:00Z",
      sessionId: "s1",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Base directory for this skill: ~/.claude/skills/example\n\nThanks for using this skill, perfect work!",
          },
        ],
      },
    });

    const messages = parseTranscript(jsonl);
    expect(messages).toHaveLength(0);
  });

  // Parameterised coverage for every INJECTED_PREFIX literal. Tests
  // verify each prefix in the source list is actually wired into the
  // filter — without these, a future edit could drop a literal from
  // INJECTED_LITERAL_PREFIXES and the regression would be invisible.
  describe.each([
    ["<command-message>", "<command-message>run /foo</command-message>", "string"],
    ["<command-args>", "<command-args>--verbose</command-args>", "string"],
    ["[Request interrupted by user", "[Request interrupted by user for tool use]", "string"],
    [
      "This session is being continued",
      "This session is being continued from a previous conversation that ran out of context.",
      "string",
    ],
  ])("filters injected prefix %s (%s shape)", (_prefix, payload) => {
    it("returns no messages for that entry", () => {
      const jsonl = line({
        type: "user",
        uuid: "u1",
        timestamp: "2026-05-25T10:00:00Z",
        sessionId: "s1",
        message: { role: "user", content: payload },
      });
      const messages = parseTranscript(jsonl);
      expect(messages).toHaveLength(0);
    });
  });

  it(
    "filters per-block in mixed arrays — injected block stripped, genuine text survives",
    () => {
      // Realistic shape: Claude Code injects a <system-reminder> block
      // alongside a genuine user continuation in the same array. The
      // filter MUST operate per-block, not per-entry, or this composite
      // case collapses to either "all noise" or "all silence" depending
      // on which way the wrong filter goes.
      const jsonl = line({
        type: "user",
        uuid: "u1",
        timestamp: "2026-05-25T10:00:00Z",
        sessionId: "s1",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "<system-reminder>Todos updated.</system-reminder>",
            },
            { type: "text", text: "Please re-run the tests." },
          ],
        },
      });

      const messages = parseTranscript(jsonl);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ role: "user", text: "Please re-run the tests." });
    },
  );

  it("handles mixed-shape transcript without throwing", () => {
    // Pre-fix, `.filter()` on a string content threw TypeError, which
    // the outer try/catch swallowed — so the string-content entry was
    // silently dropped. This test guards against any regression where
    // shape-handling crashes the whole parse call.
    const jsonl = [
      line({
        type: "user",
        uuid: "u1",
        timestamp: "2026-05-25T10:00:00Z",
        sessionId: "s1",
        message: { role: "user", content: "Real user message." },
      }),
      line({
        type: "user",
        uuid: "u2",
        timestamp: "2026-05-25T10:00:01Z",
        sessionId: "s1",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
        },
      }),
      line({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-05-25T10:00:02Z",
        sessionId: "s1",
        message: { role: "assistant", content: [{ type: "text", text: "Acknowledged." }] },
      }),
    ].join("\n");

    const messages = parseTranscript(jsonl);
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe("Real user message.");
    expect(messages[1].text).toBe("Acknowledged.");
  });

  it("skips malformed JSONL lines without crashing", () => {
    const jsonl = [
      "{not valid json",
      line({
        type: "user",
        uuid: "u1",
        timestamp: "2026-05-25T10:00:00Z",
        sessionId: "s1",
        message: { role: "user", content: "valid" },
      }),
    ].join("\n");

    const messages = parseTranscript(jsonl);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("valid");
  });
});
