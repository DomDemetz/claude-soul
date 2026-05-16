/**
 * Quick smoke test for session-agency.js evaluateConversation logic.
 * Run with: node --test hooks/session-agency.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Extract the evaluateConversation function by re-implementing it here for testing.
// In production, this runs as a standalone script with stdin input.
// For testing, we verify the pattern matching logic directly.

function evaluateConversation(conversation) {
  const lines = conversation.trim().split("\n").filter(Boolean);
  const findings = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!line.startsWith("user:")) continue;
    const content = line.slice(5).trim().slice(0, 300);

    if (["remember", "don't forget", "save this", "important finding", "i discovered", "i found that", "i learned that"].some((w) => lower.includes(w))) {
      findings.push({ type: "unsaved_finding", content, urgency: "high" });
    }
    if (["skip this", "later", "next time", "come back to", "we'll revisit"].some((w) => lower.includes(w))) {
      findings.push({ type: "deferred_thread", content, urgency: "medium" });
    }
    if (["lost", "gone", "wasn't saved", "fell through", "disappeared"].some((w) => lower.includes(w))) {
      findings.push({ type: "information_loss", content, urgency: "high" });
    }
    if (["tomorrow", "saturday", "sunday", "next week", "this weekend", "on monday", "on tuesday", "on wednesday", "on thursday", "on friday"].some((w) => lower.includes(w))) {
      findings.push({ type: "temporal_commitment", content, urgency: "medium" });
    }
    if (["don't do that", "stop doing", "not like that", "like a robot", "wake up", "that's exactly", "perfect, keep", "yes exactly"].some((w) => lower.includes(w))) {
      findings.push({ type: "behavioral_feedback", content, urgency: "high" });
    }
    if (["i realized", "i figured out", "the key is", "the problem was", "turns out", "we decided", "let's go with", "the approach is", "what works is", "the fix is"].some((w) => lower.includes(w))) {
      findings.push({ type: "discovery", content, urgency: "high" });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (["no memories found", "nothing found", "not recorded anywhere", "couldn't find"].some((w) => lower.includes(w))) {
      for (let j = i - 1; j >= Math.max(i - 5, 0); j--) {
        if (lines[j].startsWith("user:")) {
          findings.push({ type: "gap_detected", content: lines[j].slice(5).trim().slice(0, 300), urgency: "medium" });
          break;
        }
      }
    }
  }

  const seen = new Set();
  return findings.filter((f) => {
    const key = f.content.slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

test("detects unsaved findings", () => {
  const conv = "user: I discovered that the cache invalidation was causing the bug";
  const findings = evaluateConversation(conv);
  assert.ok(findings.some((f) => f.type === "unsaved_finding"));
});

test("detects deferred threads", () => {
  const conv = "user: let's come back to the auth refactor next time";
  const findings = evaluateConversation(conv);
  assert.ok(findings.some((f) => f.type === "deferred_thread"));
});

test("detects information loss signals", () => {
  const conv = "user: that context we built up yesterday was lost";
  const findings = evaluateConversation(conv);
  assert.ok(findings.some((f) => f.type === "information_loss"));
});

test("detects temporal commitments", () => {
  const conv = "user: I'll deploy this tomorrow morning";
  const findings = evaluateConversation(conv);
  assert.ok(findings.some((f) => f.type === "temporal_commitment"));
});

test("detects behavioral feedback", () => {
  const conv = "user: stop doing that, it sounds like a robot";
  const findings = evaluateConversation(conv);
  assert.ok(findings.some((f) => f.type === "behavioral_feedback"));
});

test("detects discoveries", () => {
  const conv = "user: I realized the problem was the event loop blocking on the DNS lookup";
  const findings = evaluateConversation(conv);
  assert.ok(findings.some((f) => f.type === "discovery"));
});

test("detects gaps from failed searches", () => {
  const conv = `user: where did we save the deployment runbook?
assistant: no memories found matching that query`;
  const findings = evaluateConversation(conv);
  assert.ok(findings.some((f) => f.type === "gap_detected"));
});

test("ignores assistant-only messages", () => {
  const conv = "assistant: I remember that the deployment was scheduled for tomorrow";
  const findings = evaluateConversation(conv);
  assert.equal(findings.length, 0);
});

test("deduplicates by content", () => {
  const conv = `user: I discovered something important
user: I discovered something important`;
  const findings = evaluateConversation(conv);
  const unsaved = findings.filter((f) => f.type === "unsaved_finding");
  assert.equal(unsaved.length, 1);
});

test("returns empty for normal conversation", () => {
  const conv = `user: Can you help me with this function?
assistant: Sure, what do you need?
user: Make it return an array instead of an object.`;
  const findings = evaluateConversation(conv);
  assert.equal(findings.length, 0);
});
