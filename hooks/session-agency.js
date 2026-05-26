#!/usr/bin/env node
/**
 * Agency Evaluator — reads a conversation excerpt and decides whether to:
 * 1. Save important unsaved findings to memory
 * 2. Create follow-ups for unresolved threads
 * 3. Flag gaps where information was lost
 *
 * Runs as part of the Stop hook chain. Must complete in <10s.
 *
 * Input (stdin): JSON with session_id, transcript_path, cwd
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

const HOME = homedir();
const DATA_DIR = join(HOME, ".soul", "data");
const AGENCY_LOG = join(DATA_DIR, "agency-log.json");
const FOLLOW_UPS = join(DATA_DIR, "follow-ups.json");
const FINDINGS_FILE = join(DATA_DIR, "session-findings.md");

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function saveJson(path, data) {
  const dir = join(path, "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function evaluateConversation(conversation, sessionId) {
  const lines = conversation.trim().split("\n").filter(Boolean);
  const findings = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!line.startsWith("user:")) continue;
    const content = line.slice(5).trim().slice(0, 300);

    // Pattern 1: Unsaved findings — user says "remember", "save this", etc.
    if (["remember", "don't forget", "save this", "important finding", "i discovered", "i found that", "i learned that"].some((w) => lower.includes(w))) {
      findings.push({ type: "unsaved_finding", content, urgency: "high" });
    }

    // Pattern 3: Deferred threads
    if (["skip this", "later", "next time", "come back to", "we'll revisit"].some((w) => lower.includes(w))) {
      findings.push({ type: "deferred_thread", content, urgency: "medium" });
    }

    // Pattern 4: Information loss signals
    if (["lost", "gone", "wasn't saved", "fell through", "disappeared"].some((w) => lower.includes(w))) {
      findings.push({ type: "information_loss", content, urgency: "high" });
    }

    // Pattern 5: Temporal commitments
    if (["tomorrow", "saturday", "sunday", "next week", "this weekend", "on monday", "on tuesday", "on wednesday", "on thursday", "on friday"].some((w) => lower.includes(w))) {
      findings.push({ type: "temporal_commitment", content, urgency: "medium" });
    }

    // Pattern 6: Behavioral feedback
    if (["don't do that", "stop doing", "not like that", "like a robot", "wake up", "that's exactly", "perfect, keep", "yes exactly"].some((w) => lower.includes(w))) {
      findings.push({ type: "behavioral_feedback", content, urgency: "high" });
    }

    // Pattern 7: Discoveries / decisions
    if (["i realized", "i figured out", "the key is", "the problem was", "turns out", "we decided", "let's go with", "the approach is", "what works is", "the fix is"].some((w) => lower.includes(w))) {
      findings.push({ type: "discovery", content, urgency: "high" });
    }

    // Pattern 8: Urgent save requests
    if (["write this down", "make sure this survives", "save this before", "don't let this get lost"].some((w) => lower.includes(w))) {
      findings.push({ type: "urgent_save_request", content, urgency: "high" });
    }
  }

  // Pattern 2: Gap detection — search returned nothing
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (["no memories found", "nothing found", "not recorded anywhere", "couldn't find"].some((w) => lower.includes(w))) {
      for (let j = i - 1; j >= Math.max(i - 5, 0); j--) {
        if (lines[j].startsWith("user:")) {
          findings.push({
            type: "gap_detected",
            content: lines[j].slice(5).trim().slice(0, 300),
            urgency: "medium",
          });
          break;
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  return findings.filter((f) => {
    const key = f.content.slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function logFindings(findings, sessionId) {
  let log = loadJson(AGENCY_LOG, []);
  // Trim before pushing so the new entry is always included in the write
  if (log.length >= 100) log = log.slice(-99);
  const entry = {
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    findings,
    actions_taken: [],
  };
  log.push(entry);
  saveJson(AGENCY_LOG, log);
  return entry;
}

function createFollowUp(finding) {
  const followUps = loadJson(FOLLOW_UPS, []);
  const rand = randomBytes(2).toString("hex");
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const followUp = {
    id: `fu-${ts}-${rand}`,
    created_at: new Date().toISOString(),
    type: finding.type,
    content: finding.content,
    urgency: finding.urgency,
    resolved: false,
  };
  followUps.push(followUp);

  // Keep last 50 unresolved + 20 resolved
  const unresolved = followUps.filter((f) => !f.resolved);
  const resolved = followUps.filter((f) => f.resolved).slice(-20);
  saveJson(FOLLOW_UPS, [...unresolved, ...resolved]);
  return followUp;
}

function appendCriticalFindings(findings, sessionId) {
  const critical = findings.filter((f) => f.urgency === "high");
  if (critical.length === 0) return;

  mkdirSync(DATA_DIR, { recursive: true });
  const ts = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  let content = `\n## ${ts} [${sessionId}]\n\n`;
  for (const f of critical) {
    content += `- **${f.type}**: ${f.content.slice(0, 200)}\n`;
  }
  content += "\n";

  try {
    const existing = existsSync(FINDINGS_FILE) ? readFileSync(FINDINGS_FILE, "utf-8") : "";
    writeFileSync(FINDINGS_FILE, existing + content);
  } catch {
    writeFileSync(FINDINGS_FILE, content);
  }
}

// --- Main ---

function parseTranscript(transcriptPath) {
  if (!existsSync(transcriptPath)) return "";

  const raw = readFileSync(transcriptPath, "utf-8");
  const tail = raw.slice(-20000);
  const lines = [];

  for (const line of tail.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const msgType = obj.type || "";
      if (msgType === "user" || msgType === "assistant") {
        const msg = obj.message || obj;
        const role = msg.role || msgType;
        let content = msg.content || "";
        if (Array.isArray(content)) {
          content = content
            .filter((c) => c.type === "text")
            .map((c) => c.text || "")
            .join(" ");
        }
        if (content && content.length > 10) {
          const clean = content.replace(/\s+/g, " ").trim().slice(0, 500);
          lines.push(`${role}: ${clean}`);
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return lines.slice(-20).join("\n");
}

function main() {
  let input = "";
  try {
    input = readFileSync(0, "utf-8");
  } catch {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    return;
  }

  const transcriptPath = parsed.transcript_path || "";
  const sessionId = (parsed.session_id || "unknown").slice(0, 8);

  if (!transcriptPath) return;

  const conversation = parseTranscript(transcriptPath);
  if (!conversation) return;

  const findings = evaluateConversation(conversation, sessionId);
  if (findings.length === 0) return;

  const entry = logFindings(findings, sessionId);

  for (const finding of findings) {
    const fu = createFollowUp(finding);
    entry.actions_taken.push(`follow-up created: ${fu.id}`);
  }

  appendCriticalFindings(findings, sessionId);

  // Re-save with actions
  const log = loadJson(AGENCY_LOG, []);
  if (log.length > 0) {
    log[log.length - 1] = entry;
    saveJson(AGENCY_LOG, log);
  }
}

main();
