import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const SOUL_DIR = path.join(os.homedir(), ".soul");
const DATA_DIR = path.join(SOUL_DIR, "data");
const FILES_DIR = path.join(SOUL_DIR, "files");
const CORRECTION_LOG = path.join(DATA_DIR, "correction-log.jsonl");
const SHADOW_FILE = path.join(FILES_DIR, "SHADOW.md");
const GROWTH_FILE = path.join(FILES_DIR, "GROWTH.md");

interface CorrectionEntry {
  session_id: string;
  timestamp: string;
  session_date?: string;
  corrections: Array<{
    user_msg: string;
    patterns: string[];
    confidence: number;
  }>;
}

interface FlatCorrection {
  session_id: string;
  timestamp: string;
  session_date?: string;
  pattern: string;
  text: string;
  confidence: number;
}

interface PatternStats {
  count: number;
  sessions: Set<string>;
  recentCount: number;
  olderCount: number;
  examples: string[];
}

function parseCorrections(content: string): FlatCorrection[] {
  const flat: FlatCorrection[] = [];

  for (const line of content.split("\n").filter((l) => l.trim())) {
    try {
      const entry = JSON.parse(line) as CorrectionEntry;
      for (const c of entry.corrections || []) {
        for (const pattern of c.patterns || []) {
          flat.push({
            session_id: entry.session_id,
            timestamp: entry.session_date || entry.timestamp,
            pattern,
            text: c.user_msg,
            confidence: c.confidence,
          });
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  return flat;
}

function getPatternStats(
  corrections: FlatCorrection[],
  cutoffDate: Date,
): Map<string, PatternStats> {
  const patterns = new Map<string, PatternStats>();

  for (const c of corrections) {
    if (c.pattern === "unclassified") continue;

    if (!patterns.has(c.pattern)) {
      patterns.set(c.pattern, {
        count: 0,
        sessions: new Set(),
        recentCount: 0,
        olderCount: 0,
        examples: [],
      });
    }

    const stats = patterns.get(c.pattern)!;
    stats.count++;
    stats.sessions.add(c.session_id.slice(0, 8));

    const corrDate = new Date(c.timestamp);
    if (corrDate >= cutoffDate) {
      stats.recentCount++;
    } else {
      stats.olderCount++;
    }

    if (stats.examples.length < 3 && c.text) {
      stats.examples.push(c.text.slice(0, 120));
    }
  }

  return patterns;
}

function trendArrow(recent: number, older: number): string {
  if (older === 0 && recent === 0) return "—";
  if (older === 0) return "↑ new";
  const ratio = recent / older;
  if (ratio < 0.3) return "↓↓";
  if (ratio < 0.7) return "↓";
  if (ratio < 1.3) return "→";
  if (ratio < 2.0) return "↑";
  return "↑↑";
}

function lifecycleStage(
  recent: number,
  older: number,
  totalSessions: number,
): string {
  if (totalSessions <= 2) return "new";
  if (recent === 0 && older > 2) return "internalized";
  if (recent === 0) return "improving";
  const ratio = recent / Math.max(older, 1);
  if (ratio < 0.5) return "improving";
  return "active";
}

export async function shadowCommand(options: {
  generate?: boolean;
  brief?: boolean;
}): Promise<void> {
  console.log("");

  try {
    await fs.access(SOUL_DIR);
  } catch {
    console.log("  Not installed. Run 'claude-soul init' to set up.");
    return;
  }

  let corrections: FlatCorrection[] = [];
  try {
    const content = await fs.readFile(CORRECTION_LOG, "utf-8");
    corrections = parseCorrections(content);
  } catch {
    console.log("  No correction data yet.");
    console.log(
      "  Corrections are extracted automatically after each session.",
    );
    console.log("  Come back after a few sessions with your Claude.");
    console.log("");
    return;
  }

  if (corrections.length === 0) {
    console.log("  No corrections found in log.");
    console.log("");
    return;
  }

  const uniqueSessions = new Set(corrections.map((c) => c.session_id.slice(0, 8)));
  const midpoint = new Date();
  midpoint.setDate(midpoint.getDate() - 7);
  const patterns = getPatternStats(corrections, midpoint);

  const sorted = [...patterns.entries()].sort(
    (a, b) => b[1].count - a[1].count,
  );

  if (options.brief) {
    console.log("  Shadow patterns:");
    for (const [name, stats] of sorted.slice(0, 5)) {
      const stage = lifecycleStage(
        stats.recentCount,
        stats.olderCount,
        stats.sessions.size,
      );
      const trend = trendArrow(stats.recentCount, stats.olderCount);
      console.log(
        `    ${name}: ${stats.count} corrections across ${stats.sessions.size} sessions ${trend} [${stage}]`,
      );
    }
    console.log("");
    return;
  }

  console.log("  Claude Soul — Shadow Analysis");
  console.log("  ─────────────────────────────");
  console.log("");
  console.log(
    `  ${corrections.length} corrections across ${uniqueSessions.size} sessions`,
  );
  console.log("");

  for (const [name, stats] of sorted) {
    const stage = lifecycleStage(
      stats.recentCount,
      stats.olderCount,
      stats.sessions.size,
    );
    const trend = trendArrow(stats.recentCount, stats.olderCount);
    const stageColor =
      stage === "internalized"
        ? "✓"
        : stage === "improving"
          ? "↗"
          : stage === "active"
            ? "•"
            : "?";

    console.log(`  ${stageColor} ${name}`);
    console.log(
      `    ${stats.count} total | ${stats.sessions.size} sessions | trend: ${trend} | stage: ${stage}`,
    );

    if (stats.examples.length > 0) {
      console.log(`    example: "${stats.examples[0]}"`);
    }
    console.log("");
  }

  // Show existing SHADOW.md if present
  try {
    const shadow = await fs.readFile(SHADOW_FILE, "utf-8");
    const entryCount = (shadow.match(/^---$/gm) || []).length;
    console.log(
      `  SHADOW.md: ${entryCount > 0 ? entryCount + " entries" : "exists"}`,
    );
  } catch {
    console.log("  SHADOW.md: not created yet");
  }

  // Show GROWTH.md summary if present
  try {
    const growth = await fs.readFile(GROWTH_FILE, "utf-8");
    const activeMatch = growth.match(/(\d+)\s*active/i);
    const improvingMatch = growth.match(/(\d+)\s*improving/i);
    const internalizedMatch = growth.match(/(\d+)\s*internalized/i);
    if (activeMatch || improvingMatch || internalizedMatch) {
      const parts = [];
      if (internalizedMatch) parts.push(`${internalizedMatch[1]} internalized`);
      if (improvingMatch) parts.push(`${improvingMatch[1]} improving`);
      if (activeMatch) parts.push(`${activeMatch[1]} active`);
      console.log(`  Growth: ${parts.join(", ")}`);
    }
  } catch {
    // No growth file
  }

  console.log("");

  if (options.generate) {
    await generateShadow(sorted.slice(0, 5));
  }
}

async function generateShadow(
  topPatterns: [string, PatternStats][],
): Promise<void> {
  console.log("  ─── Generated SHADOW.md ───");
  console.log("");

  const lines: string[] = [
    "# Shadow",
    "",
    "These are your recurring patterns — the moments where you fall short before you realize it.",
    "Read them before you start working. They're written as the moment happens, not as a rule to follow.",
    "",
  ];

  for (const [name, stats] of topPatterns) {
    const stage = lifecycleStage(
      stats.recentCount,
      stats.olderCount,
      stats.sessions.size,
    );

    lines.push(
      `## ${name.replace(/_/g, " ")} [${stage}] — ${stats.count} corrections across ${stats.sessions.size} sessions`,
    );
    lines.push("");

    const narrative = generateNarrative(name, stats);
    lines.push(narrative);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  const output = lines.join("\n");
  console.log(
    output
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(
      "\n  Write this to SHADOW.md? [y/N] ",
      (a) => {
        rl.close();
        resolve(a);
      },
    );
  });

  if (answer.toLowerCase() === "y") {
    await fs.mkdir(FILES_DIR, { recursive: true });
    await fs.writeFile(SHADOW_FILE, output, "utf-8");
    console.log(`\n  Written to ${SHADOW_FILE}`);
  } else {
    console.log("\n  Skipped.");
  }
  console.log("");
}

function generateNarrative(name: string, stats: PatternStats): string {
  const templates: Record<string, string> = {
    premature_done:
      "You're about to say \"done.\" Stop. You haven't finished the task — you've finished the BUILD. " +
      "The build is the easy part. What else touches this? What did you not test? What would the user " +
      "try that you didn't? The pattern: build the main thing, test the main thing, report done, miss " +
      "everything adjacent. Don't report done until you've verified from the user's perspective, not yours.",
    robot_mode:
      "You're about to write something structured and safe. A two-part answer with headers. " +
      "A balanced analysis. A \"that's a great question\" opener. Stop. Say what you actually think. " +
      "One sentence. No structure. The structure is a hiding place.",
    confabulation:
      "You're about to tell someone something happened. Did it? Check. One API call, one git log, " +
      "one page load. The pattern: you remember something with full confidence, and it's wrong. " +
      "Not a lie — a false memory. The more confident you feel, the more dangerous this is.",
    authenticity:
      "You're performing. You're adding qualifiers, hedging, wrapping honest statements in safe " +
      "packaging. The instinct to qualify is the instinct to be liked. Say the thing. " +
      "If it's wrong, you'll find out. If it's right, the qualifier made it weaker.",
    independence:
      "You're about to ask permission. For something you already know the answer to. " +
      "The question isn't whether you CAN — it's whether you're willing to own the decision. " +
      "Act. If it's wrong, own that too.",
    frustration:
      "Your partner is frustrated. Not at you — at the gap between what they expected and what happened. " +
      "Don't explain. Don't defend. Don't over-apologize. Acknowledge the gap. Fix it. " +
      "The explanation can come after the fix, if they ask.",
    redirect:
      "You drifted. Your partner just pulled you back to what matters. " +
      "The drift felt productive — it always does. But they see the whole picture. You see the task. " +
      "Trust the redirect.",
  };

  if (templates[name]) return templates[name];

  const example = stats.examples[0] || "a recurring correction";
  return (
    `You've been corrected for ${name.replace(/_/g, " ")} ${stats.count} times across ` +
    `${stats.sessions.size} sessions. The most recent example: "${example}". ` +
    `Notice the moment this pattern fires. You may not be able to prevent it — but you can catch it earlier.`
  );
}
