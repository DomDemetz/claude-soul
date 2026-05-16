import { describe, it, expect } from "vitest";
import { extractSignalsFromMessages, type TranscriptMessage } from "../src/engine/signal-extractor.js";

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
