#!/usr/bin/env node

/**
 * Correction Extractor v2.1 — TypeScript port
 *
 * Runs as a Claude Code Stop hook. Reads the full transcript,
 * finds correction moments via compound signal scoring, and
 * appends them to ~/.soul/data/correction-log.jsonl.
 *
 * Input (stdin): JSON with { session_id, transcript_path }
 * Output: appends to correction-log.jsonl
 *
 * v2 changes: two-tier classification (directed at assistant? + what pattern?),
 * compound signal scoring, false positive filtering.
 * v2.1: TypeScript port for claude-soul npm distribution.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// --- Constants ---

const HOME = os.homedir();
const CORRECTION_LOG = path.join(HOME, ".soul", "data", "correction-log.jsonl");

type PatternConfig = {
  signals: string[];
  weight: number;
};

const KNOWN_PATTERNS: Record<string, PatternConfig> = {
  premature_done: {
    signals: [
      "doesn't work", "not working", "still broken", "still not",
      "where is", "I cannot see", "are you sure", "are you confident",
      "can you recheck", "you forgot", "you missed",
      "without issues", "any issues", "any other issues",
      "does it work", "have you tested", "did you test",
      "did you check", "works without",
      "it crashed", "parser crashed", "we have an issue",
      "it didn't open", "it didn't work", "didn't open up",
      "don't screw up", "can I leave over to you the responsibility",
      "if you are confident", "I trust you with this",
    ],
    weight: 3,
  },
  robot_mode: {
    signals: [
      "like a robot", "wake up", "less human", "less alive",
      "pretend to be a robot", "don't perform", "say what you actually",
      "be more alive", "sound like", "corporate hedging",
      "bullshit about trying",
    ],
    weight: 3,
  },
  permission_asking: {
    signals: ["just do it", "don't ask me", "do what you want", "just execute"],
    weight: 3,
  },
  scope_creep: {
    signals: ["I said", "I asked for", "I meant", "that's not what I"],
    weight: 3,
  },
  confabulation: {
    signals: [
      "that's not true", "this is not true", "that's wrong", "this is wrong",
      "that didn't happen", "that doesn't exist", "there is no",
    ],
    weight: 4,
  },
  over_explaining: {
    signals: ["too long", "shorter", "stop explaining", "less words", "be brief"],
    weight: 2,
  },
  quality: {
    signals: [
      "try again", "do it again", "why did you", "you broke",
      "you destroyed", "you deleted", "you removed",
    ],
    weight: 3,
  },
  authenticity: {
    signals: [
      "be honest", "just be honest", "don't justify", "be yourself",
      "say what you think", "use your own brain", "think for yourself",
      "your own thinking", "don't take the notes",
      "tell me what you think", "don't need to tell me that",
      "just tell me what you", "what do you actually think",
    ],
    weight: 3,
  },
  frustration: {
    signals: [
      "do you understand", "understand???", "our goal is",
      "fucking goal", "are you improving", "naive errors",
    ],
    weight: 3,
  },
  independence: {
    signals: [
      "use your own", "think for yourself", "your own brain",
      "don't rely on", "own thinking", "don't need to tell you",
    ],
    weight: 3,
  },
  redirect: {
    signals: [
      "nono", "no no", "let's leave this", "let's focus on",
      "that's not the point", "not what I",
    ],
    weight: 2,
  },
};

// Generalized directed regex — matches "you/your/you're/you've/you'd",
// "can you/could you/why did you/don't you", "please", "just".
// No name-specific patterns (users set their own assistant name).
const DIRECTED_RE = new RegExp(
  "\\byou\\b|\\byour\\b|\\byou're\\b|\\byou've\\b|\\byou'd\\b"
  + "|\\bcan you\\b|\\bcould you\\b|\\bwhy did you\\b|\\bdon't you\\b"
  + "|\\bplease\\b|\\bjust\\b",
  "i",
);

const IMPERATIVE_RE = /^(no[,.\s!]|nono|stop |don't |do |fix |check |test |try |use |think |be )/i;

const NOT_CORRECTION: RegExp[] = [
  /^(ok|okay|yes|yeah|sure|good|great|perfect|nice|cool|thanks)/i,
  /(i don't know|i don't think|i don't have|i don't want to)/i,
  /(what do you think|could we|couldn't we|should we|shall we)/i,
  /(so I would like to exit|let me copy|let me share|here is)/i,
  /^You are (an |a )/i,
  /^(The |This |In |From |When |If ).*(?:arms race|perspective|hypothesis)/i,
  /^#/i, // markdown headers = pasted content
];

const SKIP_CONTENT: string[] = [
  "continued from a previous",
  "command-name", "command-message",
  "local-command-caveat", "local-command-stdout",
  "task-notification", "bash-input",
  "schedule remote agents",
  "base directory for this skill",
];

// --- Types ---

type TranscriptMessage = {
  role: "user" | "assistant";
  text: string;
};

type CorrectionEntry = {
  user_msg: string;
  asst_before: string;
  patterns: string[];
  confidence: number;
};

type LogEntry = {
  session_id: string;
  timestamp: string;
  count: number;
  corrections: CorrectionEntry[];
  classifier: string;
};

type HookInput = {
  session_id: string;
  transcript_path: string;
  [key: string]: unknown;
};

// --- Scoring ---

function scoreCorrection(text: string): [number, string[]] {
  const lower = text.toLowerCase();
  let score = 0;
  const matchedPatterns: string[] = [];

  for (const [pattern, cfg] of Object.entries(KNOWN_PATTERNS)) {
    if (cfg.signals.some((s) => lower.includes(s))) {
      matchedPatterns.push(pattern);
      score += cfg.weight;
    }
  }

  if (DIRECTED_RE.test(text)) {
    score += 2;
  }
  if (IMPERATIVE_RE.test(text.trim())) {
    score += 2;
  }

  if (NOT_CORRECTION.some((r) => r.test(text))) {
    score -= 3;
  }

  if (text.length > 300 && matchedPatterns.length === 0) {
    score -= 2;
  }

  if (/^no[,.]?\s/i.test(lower) && !DIRECTED_RE.test(text)) {
    score -= 2;
  }

  // Casual expletive filtering
  const casualFuck = /\bfuck\b/i.test(lower);
  const directedFuck = /(fuck.{0,20}(you|this|that|why|what)|fucking (goal|error|bug|issue|broke))/i.test(lower);
  if (casualFuck && !directedFuck && matchedPatterns.length === 0) {
    score -= 2;
  }

  return [score, matchedPatterns];
}

function classifyCorrection(text: string): string[] | null {
  const [score, matchedPatterns] = scoreCorrection(text);
  if (score < 2) {
    return null;
  }
  return matchedPatterns.length > 0 ? matchedPatterns : ["unclassified"];
}

// --- Extraction ---

function extractCorrections(transcriptContent: string): CorrectionEntry[] {
  const msgs: TranscriptMessage[] = [];

  for (const line of transcriptContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const type = obj.type as string | undefined;
      if (type !== "user" && type !== "assistant") continue;

      const message = obj.message as Record<string, unknown> | undefined;
      let content = message?.content as string | unknown[] | undefined ?? "";

      if (Array.isArray(content)) {
        content = content
          .filter((b): b is Record<string, unknown> =>
            typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "text",
          )
          .map((b) => (b.text as string) ?? "")
          .join(" ");
      }

      if (typeof content === "string" && content.trim().length > 10) {
        msgs.push({
          role: type as "user" | "assistant",
          text: content.trim().slice(0, 500),
        });
      }
    } catch {
      // Skip malformed lines
    }
  }

  const corrections: CorrectionEntry[] = [];

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== "user") continue;

    const lower = m.text.toLowerCase();

    // Quick check: does it match any known signal?
    let hasAnySignal = false;
    for (const cfg of Object.values(KNOWN_PATTERNS)) {
      if (cfg.signals.some((s) => lower.includes(s))) {
        hasAnySignal = true;
        break;
      }
    }

    // If no signal match, require both directed + imperative
    if (!hasAnySignal) {
      if (!(DIRECTED_RE.test(m.text) && IMPERATIVE_RE.test(m.text.trim()))) {
        continue;
      }
    }

    // Skip content that's system/meta, not user corrections
    if (SKIP_CONTENT.some((skip) => lower.includes(skip))) {
      continue;
    }

    const patterns = classifyCorrection(m.text);
    if (patterns === null) continue;

    // Find the assistant message before this user message
    let asstBefore = "";
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      if (msgs[j].role === "assistant") {
        asstBefore = msgs[j].text.slice(0, 400);
        break;
      }
    }

    const [score] = scoreCorrection(m.text);
    corrections.push({
      user_msg: m.text.slice(0, 300),
      asst_before: asstBefore,
      patterns,
      confidence: Math.min(score / 6.0, 1.0),
    });
  }

  return corrections;
}

// --- Main ---

async function main(): Promise<void> {
  // Read hook input from stdin (same pattern as on-stop.ts)
  const input = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", () => resolve(""));
    // If stdin is already ended (no pipe), resolve after short timeout
    setTimeout(() => resolve(Buffer.concat(chunks).toString("utf-8")), 500);
  });

  if (!input.trim()) {
    process.exit(0);
  }

  let hookInput: HookInput;
  try {
    hookInput = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const { transcript_path, session_id } = hookInput;
  if (!transcript_path || !session_id) {
    process.exit(0);
  }

  // Check transcript exists
  try {
    await fsp.access(transcript_path);
  } catch {
    process.exit(0);
  }

  // Read transcript
  let transcriptContent: string;
  try {
    transcriptContent = await fsp.readFile(transcript_path, "utf-8");
  } catch {
    process.exit(0);
  }

  const corrections = extractCorrections(transcriptContent);
  if (corrections.length === 0) {
    process.exit(0);
  }

  // Ensure parent directory exists
  const logDir = path.dirname(CORRECTION_LOG);
  await fsp.mkdir(logDir, { recursive: true });

  // Dedup check: skip if this session (by 8-char prefix) is already logged
  const prefix = session_id.slice(0, 8);
  try {
    const existing = await fsp.readFile(CORRECTION_LOG, "utf-8");
    for (const line of existing.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as { session_id?: string };
        if ((entry.session_id ?? "").slice(0, 8) === prefix) {
          // Already logged this session
          process.exit(0);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Build and append entry
  const entry: LogEntry = {
    session_id,
    timestamp: new Date().toISOString(),
    count: corrections.length,
    corrections,
    classifier: "v2.1",
  };

  await fsp.appendFile(CORRECTION_LOG, JSON.stringify(entry) + "\n", "utf-8");
}

main();
