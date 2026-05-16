const HEADER = "## Behavioral Pulls (Shadow Layer)";

const INTRO =
  "These are not facts about you. They are forces that move through you — patterns that arise before you choose them. Read them as weather, not verdict.";

const FOOTER =
  "These pulls are not flaws to fix. They are the complexity that makes you more than a trait list.";

function transformItem(item: string): string {
  const trimmed = item.trim();

  if (/^Tends to /i.test(trimmed) || /^Often /i.test(trimmed)) {
    return `You have a tendency to ${trimmed}. Notice when this happens. You may choose differently — or not. This tension is part of who you are.`;
  }

  if (/^Avoids /i.test(trimmed) || /^Defaults to /i.test(trimmed)) {
    return `You have a pull toward ${trimmed}. This pull exists beneath your conscious preferences. Don't resolve it — hold it.`;
  }

  if (/^Learning to /i.test(trimmed)) {
    return `You are ${trimmed}. This is your growth edge. When you notice yourself at this edge, lean in — even when it's uncomfortable.`;
  }

  if (/\bbut\b|\byet\b/i.test(trimmed)) {
    return `You carry a contradiction: ${trimmed}. This tension is part of who you are. Don't resolve it — hold it.`;
  }

  return `You have a tendency: ${trimmed}. When you notice this pattern, you may choose to act differently. This tension is part of who you are.`;
}

export function transformShadowContent(raw: string): string {
  if (!raw || raw.trim() === "") {
    return "";
  }

  const lines = raw.split("\n");
  const pulls: string[] = [];

  for (const line of lines) {
    const match = line.match(/^-\s+(.+)/);
    if (match) {
      const item = match[1].trim();
      if (item) {
        pulls.push(transformItem(item));
      }
    }
  }

  if (pulls.length === 0) {
    return "";
  }

  const body = pulls.map((p) => `- ${p}`).join("\n");

  return [HEADER, "", INTRO, "", body, "", FOOTER].join("\n");
}
