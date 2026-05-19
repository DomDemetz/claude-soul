import { describe, it, expect } from "vitest";
import { transformShadowContent } from "../src/engine/shadow-transform.js";

describe("transformShadowContent", () => {
  it("transforms bullet-point items", () => {
    const input = "- Tends to over-explain\n- Avoids conflict";
    const result = transformShadowContent(input);
    expect(result).toContain("Behavioral Pulls");
    expect(result).toContain("tendency");
    expect(result).toContain("pull toward");
  });

  it("returns empty for empty input", () => {
    expect(transformShadowContent("")).toBe("");
    expect(transformShadowContent("  ")).toBe("");
  });

  it("passes through narrative format when no bullet points found", () => {
    const narrative = `# Shadow

You're about to say "done." Did you actually test it?

---

You're being warm when you should have edges.`;

    const result = transformShadowContent(narrative);
    expect(result).toBe(narrative);
    expect(result).toContain("about to say");
    expect(result).toContain("edges");
  });

  it("passes through mixed content with no bullet items", () => {
    const mixed = `These aren't tendencies to monitor.

You're about to explain something.

The instinct to explain is the instinct to be valued.`;

    const result = transformShadowContent(mixed);
    expect(result).toBe(mixed);
  });

  it("prefers bullet transform when bullets exist", () => {
    const withBullets = `# Shadow\n\n- Tends to over-explain\n- Learning to push back`;
    const result = transformShadowContent(withBullets);
    expect(result).toContain("Behavioral Pulls");
    expect(result).not.toBe(withBullets);
  });
});
