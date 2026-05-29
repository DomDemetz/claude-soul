import type { MicroSignal, SignalType } from "../types/learning-types.js";

const COMMON_WORDS = new Set([
  "about", "after", "again", "also", "another", "because", "been", "before",
  "being", "between", "both", "could", "does", "doing", "don't", "during",
  "each", "from", "further", "have", "having", "here", "itself", "just",
  "like", "more", "most", "need", "other", "over", "same", "should",
  "since", "some", "still", "such", "than", "that", "their", "them",
  "then", "there", "these", "they", "this", "those", "through", "time",
  "under", "until", "very", "want", "were", "what", "when", "where",
  "which", "while", "will", "with", "would", "your",
]);

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function wordSet(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\W+/).filter((w) => w.length > 0),
  );
}

function wordOverlapRatio(a: string, b: string): number {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) {
    if (setB.has(w)) shared++;
  }
  return shared / Math.max(setA.size, setB.size);
}

function extractNouns(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\W+/).filter((w) => w.length > 4 && !COMMON_WORDS.has(w)),
  );
}

function nounOverlapRatio(a: string, b: string): number {
  const nouns1 = extractNouns(a);
  const nouns2 = extractNouns(b);
  if (nouns1.size === 0 || nouns2.size === 0) return 1;
  let shared = 0;
  for (const n of nouns1) {
    if (nouns2.has(n)) shared++;
  }
  return shared / Math.max(nouns1.size, nouns2.size);
}

// Regex patterns for signal detection
const CORRECTION_PATTERN = /\bno[,\s]|\bwrong\b|actually,|not what i|that'?s not|incorrect/i;
const GRATITUDE_PATTERN = /thanks|thank you|perfect|exactly|great work|awesome/i;
const CONFUSION_PATTERN = /what do you mean|don'?t understand|confused|\bhuh\?/i;
const COMPLETION_PATTERN = /\b(done|works|fixed)\b/i;
const IDENTITY_DRIFT_PATTERN = /\b(robot|machine|sound like a|wake up|not alive|you('?re| are) off|lost .*(identity|voice|energy))\b/i;

export type TranscriptMessage = {
  role: "user" | "assistant";
  text: string;
};

/**
 * Extract signals from a list of transcript messages.
 * Adapted from the OpenClaw version to work with Claude Code transcripts.
 */
export function extractSignalsFromMessages(
  messages: TranscriptMessage[],
  sessionKey: string,
): MicroSignal[] {
  const signals: MicroSignal[] = [];
  const addedTypes = new Set<SignalType>();

  // Use up to last 10 messages for analysis
  const window = messages.slice(-10);

  const userMsgs = window.filter((m) => m.role === "user");
  const assistantMsgs = window.filter((m) => m.role === "assistant");

  const lastTwoUser = userMsgs.slice(-2).map((m) => truncate(m.text, 300));
  const lastTwoAssistant = assistantMsgs.slice(-2).map((m) => truncate(m.text, 300));

  function makeSignal(type: SignalType, evidence: string, confidence: number): MicroSignal {
    return {
      timestamp: Date.now(),
      sessionKey,
      type,
      evidence: truncate(evidence, 200),
      source: "user",
      confidence,
      userSnippets: lastTwoUser,
      assistantSnippets: lastTwoAssistant,
      consumedBy: [],
    };
  }

  function addSignal(signal: MicroSignal) {
    if (!addedTypes.has(signal.type)) {
      addedTypes.add(signal.type);
      signals.push(signal);
    }
  }

  // Track for multi-message patterns
  let prevUserLength: number | null = null;
  let prevAssistantText: string | null = null;
  const gratitudeIndices: number[] = [];
  const completionIndices: number[] = [];

  for (let i = 0; i < window.length; i++) {
    const { role, text } = window[i];

    if (role === "user") {
      // correction — high confidence for explicit phrases
      if (CORRECTION_PATTERN.test(text)) {
        const confidence = /actually,|that'?s not|incorrect|not what i/i.test(text) ? 0.9 : 0.6;
        addSignal(makeSignal("correction", text, confidence));
      }

      // gratitude
      if (GRATITUDE_PATTERN.test(text)) {
        const confidence = /perfect|exactly|great work/i.test(text) ? 0.9 : 0.7;
        addSignal(makeSignal("gratitude", text, confidence));
        gratitudeIndices.push(i);
      }

      // confusion
      const trimmed = text.trim();
      if (trimmed === "?") {
        addSignal(makeSignal("confusion", text, 0.6));
      } else if (CONFUSION_PATTERN.test(text)) {
        addSignal(makeSignal("confusion", text, 0.8));
      }

      // disengagement: user message < 10 chars AND previous assistant > 200 chars
      if (text.length < 10 && prevAssistantText !== null && prevAssistantText.length > 200) {
        addSignal(makeSignal("disengagement", text, 0.5));
      }

      // depth_change: length ratio >3x compared to previous user message
      if (prevUserLength !== null && prevUserLength > 0) {
        const ratio = text.length / prevUserLength;
        if (ratio > 3 || ratio < 0.3) {
          addSignal(makeSignal("depth_change", text, 0.6));
        }
      }

      // identity drift — user calling out robot mode, loss of presence
      if (IDENTITY_DRIFT_PATTERN.test(text)) {
        addSignal(makeSignal("identity_drift", text, 0.95));
      }

      // completion language tracking
      if (COMPLETION_PATTERN.test(text)) {
        completionIndices.push(i);
      }

      prevUserLength = text.length;
    } else if (role === "assistant") {
      prevAssistantText = text;
    }
  }

  // rephrasing: two user messages within 3 turns share >40% words but aren't identical
  if (!addedTypes.has("rephrasing") && userMsgs.length >= 2) {
    for (let i = 0; i < window.length; i++) {
      if (window[i].role !== "user") continue;
      for (let j = i + 1; j < window.length && j - i <= 4; j++) {
        if (window[j].role !== "user") continue;
        const a = window[i].text;
        const b = window[j].text;
        if (a !== b && wordOverlapRatio(a, b) > 0.4) {
          addSignal(makeSignal("rephrasing", b, 0.7));
          break;
        }
      }
      if (addedTypes.has("rephrasing")) break;
    }
  }

  // topic_shift: consecutive user messages with <20% noun overlap
  if (!addedTypes.has("topic_shift") && userMsgs.length >= 2) {
    for (let i = 0; i < userMsgs.length - 1; i++) {
      if (nounOverlapRatio(userMsgs[i].text, userMsgs[i + 1].text) < 0.2) {
        addSignal(makeSignal("topic_shift", userMsgs[i + 1].text, 0.6));
        break;
      }
    }
  }

  // success: task-completion language + gratitude within 2 turns
  if (!addedTypes.has("success")) {
    for (const ci of completionIndices) {
      for (const gi of gratitudeIndices) {
        if (Math.abs(ci - gi) <= 2) {
          const evidenceIdx = Math.max(ci, gi);
          addSignal(makeSignal("success", window[evidenceIdx].text, 0.85));
          break;
        }
      }
      if (addedTypes.has("success")) break;
    }
  }

  return signals;
}

/**
 * Content block from Claude Code transcript JSONL.
 */
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: "thinking"; thinking: string }
  | { type: string };

/**
 * A single entry from the transcript JSONL file.
 *
 * `message.content` is a discriminated union: a bare string for genuine
 * human-typed user turns, and an array of content blocks for assistant
 * turns and for system-injected user-role messages — including (but not
 * limited to) tool_result blocks, system reminders, slash-command
 * artifacts, and Skill tool result bodies. Treating it as always-array
 * dropped every real user message.
 */
type TranscriptEntry = {
  type: "user" | "assistant" | "system" | "summary" | string;
  uuid: string;
  timestamp: string;
  sessionId: string;
  message?: {
    role: "user" | "assistant";
    content: string | ContentBlock[];
  };
};

/**
 * Prefixes identifying user-role text that was injected by Claude Code
 * rather than typed by the user. Keeping these out of the signal stream
 * is what prevents Skill tool result bodies (e.g. SKILL.md content) from
 * pattern-matching as user gratitude / corrections / completion signals.
 *
 * Each entry is a plain literal prefix; the matcher anchors at start-of-
 * string with leading whitespace tolerance. Add new prefixes here as
 * Claude Code introduces additional injected user-role content types.
 */
const INJECTED_LITERAL_PREFIXES: readonly string[] = [
  // Reminder injections (todo, post-tool, etc.) — wrap as XML-ish tag
  "<system-reminder>",
  // Slash-command artifacts (`/clear`, `/help`, …)
  "<local-command-caveat>",
  "<command-name>",
  "<command-message>",
  "<command-args>",
  // Skill tool result body — SKILL.md content delivered as a text block
  "Base directory for this skill:",
  // Interrupt + post-compact continuation banners
  "[Request interrupted by user",
  "This session is being continued from a previous conversation",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const INJECTED_PREFIX = new RegExp(
  "^\\s*(" + INJECTED_LITERAL_PREFIXES.map(escapeRegex).join("|") + ")",
);

/**
 * Parse a Claude Code transcript JSONL file into messages suitable for signal extraction.
 *
 * The per-line `try/catch` is narrowed to `JSON.parse` only. Shape-handling
 * errors are NOT swallowed — they propagate so future schema drift in
 * Claude Code's JSONL surfaces loudly instead of producing empty output.
 */
export function parseTranscript(jsonlContent: string): TranscriptMessage[] {
  const lines = jsonlContent.split("\n").filter((l) => l.trim().length > 0);
  const messages: TranscriptMessage[] = [];

  for (const line of lines) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      // Skip malformed JSONL lines.
      continue;
    }

    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (!entry.message?.content) continue;

    const content = entry.message.content;
    let text: string;

    if (typeof content === "string") {
      if (INJECTED_PREFIX.test(content)) continue;
      text = content.trim();
    } else if (Array.isArray(content)) {
      const textParts = content
        .filter((c): c is { type: "text"; text: string } =>
          c.type === "text" && typeof (c as { text?: unknown }).text === "string",
        )
        .map((c) => c.text)
        .filter((t) => !INJECTED_PREFIX.test(t));

      text = textParts.join("\n").trim();
    } else {
      // Unknown content shape (neither string nor array). Log so future
      // schema drift is observable rather than a silent skip.
      console.error(
        "[signal-extractor] parseTranscript: unknown content shape " +
          `(type=${typeof content}); skipping entry uuid=${entry.uuid}`,
      );
      continue;
    }

    if (!text) continue;

    messages.push({
      role: entry.message.role,
      text,
    });
  }

  return messages;
}
