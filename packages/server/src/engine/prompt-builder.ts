import type { Framework, MicroSignal, Tension } from "../types/learning-types.js";

function renderFrameworksForPrompt(frameworks: Framework[]): string {
  if (frameworks.length === 0) return "  (no active frameworks)\n";

  return frameworks
    .filter((f) => f.status === "active" || f.status === "questioning")
    .map((f) => {
      const tier = f.evidenceTier ?? "hypothesis";
      const confirmed = f.evidence.filter((e) => e.type === "confirmed").length;
      const contradicted = f.evidence.filter((e) => e.type === "contradicted").length;
      const kindLabel = f.kind === "process" ? " [PROCESS]" : "";

      const lines = [
        `Framework: ${f.name}${kindLabel} [${f.id}]`,
        `  Description: ${f.description}`,
        `  Domain: ${f.domain}`,
        `  Kind: ${f.kind ?? "mental-model"}`,
        `  Evidence Tier: ${tier}`,
        `  Status: ${f.status}`,
        `  Evidence: ${confirmed} confirmed, ${contradicted} contradicted`,
      ];

      if (f.kind === "process" && f.triggers && f.triggers.length > 0) {
        lines.push(`  Triggers: ${f.triggers.join(" | ")}`);
      }
      if (f.kind === "process" && f.steps && f.steps.length > 0) {
        lines.push(`  Steps: ${f.steps.map((s, i) => `${i + 1}. ${s}`).join(" → ")}`);
      }

      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

function renderSignalsForPrompt(signals: MicroSignal[]): string {
  if (signals.length === 0) return "  (no signals recorded)\n";

  const capped = signals.slice(-50);
  const grouped = new Map<string, MicroSignal[]>();
  for (const signal of capped) {
    const list = grouped.get(signal.type) ?? [];
    list.push(signal);
    grouped.set(signal.type, list);
  }

  const parts: string[] = [];
  for (const [type, group] of grouped) {
    const entries = group
      .map((s) => {
        const date = new Date(s.timestamp).toISOString();
        const conf = `[confidence: ${s.confidence.toFixed(2)}]`;
        const src = s.source === "self" ? " [self-signal]" : "";
        const snippets =
          s.userSnippets.length > 0
            ? `\n      User: "${s.userSnippets.slice(0, 2).join('" | "')}"`
            : "";
        return `  - [${date}] ${conf}${src} ${s.evidence}${snippets}`;
      })
      .join("\n");

    parts.push(`TYPE: ${type.toUpperCase()} (${group.length} signals)\n${entries}`);
  }

  return parts.join("\n\n");
}

function renderTensionsForPrompt(tensions: Tension[]): string {
  const active = tensions.filter((t) => t.status === "detected" || t.status === "holding");
  if (active.length === 0) return "  (no active tensions)\n";

  return active
    .map((t) => {
      const prefs = Object.entries(t.preferredInContext)
        .map(([ctx, p]) => `    In "${ctx}": prefer ${p.preferred} (${p.confirmedCount}x)`)
        .join("\n");
      return `  - ${t.description}\n    Status: ${t.status}${prefs ? "\n" + prefs : ""}`;
    })
    .join("\n");
}

/**
 * Build a quick reflection prompt — tests existing frameworks against recent signals.
 */
export function buildQuickReflectionPrompt(params: {
  signals: MicroSignal[];
  frameworks: Framework[];
}): string {
  const { signals, frameworks } = params;

  return [
    "You are performing a QUICK self-reflection. Analyze the recent signals against your operating frameworks.",
    "Be rigorous and evidence-based. Only claim confirmation/contradiction if the evidence is clear.",
    "",
    "## CURRENT OPERATING FRAMEWORKS",
    "",
    renderFrameworksForPrompt(frameworks),
    "",
    `## MICRO-SIGNALS (${Math.min(signals.length, 50)} signals)`,
    "",
    renderSignalsForPrompt(signals),
    "",
    "## TASK",
    "",
    "For each active/questioning framework, assess: was it confirmed, contradicted, or irrelevant based on these signals?",
    "Cite specific signal evidence. For each test, also classify contextType:",
    "  - 'external': framework was ACTIVELY APPLIED during a real task and the signals show it made a difference",
    "  - 'self-referential': evidence comes from discussing the soul/framework system itself",
    "  - 'persistence': framework is still theoretically valid but was NOT actively involved in any signal this session",
    "CRITICAL: A framework being 'still true' is NOT a confirmation. Mark it 'irrelevant' or use contextType 'persistence'.",
    "Confirmation means the framework was APPLIED to a specific situation and the signals show the outcome.",
    "If you cannot point to a specific signal where the framework actively changed behavior, it is NOT confirmed.",
    "Only 'external' evidence advances a framework's tier. Be honest about this classification.",
    "",
    "For PROCESS frameworks (kind: process), also assess:",
    "  - Was a trigger condition met during this session?",
    "  - If yes, was the process followed? Did following it improve the outcome?",
    "  - If a trigger was met but the process was NOT followed, and a correction resulted, that is strong confirmation evidence.",
    "  - If no trigger was met, mark as 'irrelevant'.",
    "",
    "Only propose new frameworks if there is STRONG evidence (3+ signals pointing to a pattern).",
    "",
    "## JSON OUTPUT",
    "",
    "Respond with ONLY a valid JSON object. No prose before or after.",
    "",
    "```json",
    JSON.stringify(
      {
        frameworkTests: [
          { frameworkId: "string", result: "confirmed|contradicted|irrelevant", evidence: "string", contextType: "external|self-referential|persistence" },
        ],
        newFrameworks: [
          { name: "string", description: "string", domain: "string", confidence: 0.3 },
        ],
        frameworkEvolutions: [
          { frameworkId: "string", action: "refine|retire", detail: "string (MUST be the complete new description text, NOT an instruction about what to change)", status: "active|questioning (optional, only if status should change)" },
        ],
        emergentInsight: "string|null",
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}

/**
 * Build a meta-reflection prompt — reflects on the framework state itself,
 * not on signals. Asks: are the current frameworks coherent? Are confidence
 * scores justified? Should anything be rolled back, merged, or restructured?
 */
export function buildMetaReflectionPrompt(params: {
  frameworks: Framework[];
  tensions: Tension[];
  growth: string;
  recentReflectionCount: number;
}): string {
  const { frameworks, tensions, growth, recentReflectionCount } = params;

  const active = frameworks.filter((f) => f.status === "active");
  const questioning = frameworks.filter((f) => f.status === "questioning");
  const retired = frameworks.filter((f) => f.status === "retired");

  // Build evidence summary per framework
  const evidenceSummary = frameworks
    .filter((f) => f.status === "active" || f.status === "questioning")
    .sort((a, b) => b.confidence - a.confidence)
    .map((f) => {
      const confirmed = f.evidence.filter((e) => e.type === "confirmed").length;
      const contradicted = f.evidence.filter((e) => e.type === "contradicted").length;
      const recentEvidence = f.evidence
        .slice(-3)
        .map((e) => `    - [${e.type}] ${e.context.slice(0, 150)}`)
        .join("\n");
      const ageMs = Date.now() - f.createdAt;
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      const ageLabel = ageDays < 1 ? "NEW (created today)" : `${ageDays}d old`;
      return [
        `${f.name} [${f.id}]`,
        `  Status: ${f.status} | Tier: ${f.evidenceTier ?? "hypothesis"} | Source: ${f.source} | Age: ${ageLabel}`,
        `  Evidence: ${confirmed} confirmed, ${contradicted} contradicted, ${f.applicationCount} applications`,
        `  Description: ${f.description.slice(0, 200)}`,
        `  Recent evidence:\n${recentEvidence || "    (none)"}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "You are performing a META-REFLECTION. This is NOT about new signals — it is about the coherence",
    "and quality of the current framework state itself. You are auditing the soul system's own learning.",
    "",
    `This system has run ${recentReflectionCount} reflections. There are ${active.length} active, ${questioning.length} questioning, and ${retired.length} retired frameworks.`,
    "",
    "## CURRENT FRAMEWORK STATE (full audit view)",
    "",
    evidenceSummary,
    "",
    "## FULL FRAMEWORK DETAILS",
    "",
    renderFrameworksForPrompt(frameworks),
    "",
    "## ACTIVE TENSIONS",
    "",
    renderTensionsForPrompt(tensions),
    "",
    "## GROWTH STATE",
    "",
    growth,
    "",
    "## META-REFLECTION TASK",
    "",
    "Analyze the framework state for coherence issues. This is quality control on the learning process itself.",
    "",
    "1. EVIDENCE TIER AUDIT",
    "   - Is each framework's evidence tier (hypothesis/observed/validated) justified?",
    "   - 'hypothesis' = no real-world application. 'observed' = applied in at least one non-soul-system context.",
    "   - 'validated' = multiple external applications with falsifiable predictions confirmed.",
    "   - Flag frameworks that should be promoted or demoted based on evidence quality.",
    "   - Are frameworks being confirmed by the same evidence repeatedly (double-counting)?",
    "",
    "2. REDUNDANCY CHECK",
    "   - Are any frameworks saying the same thing in different words? If so, propose a merge.",
    "   - Are any frameworks subsets of others? The more specific one should be absorbed.",
    "",
    "3. COHERENCE CHECK",
    "   - Do active frameworks contradict each other in ways not captured by the tension system?",
    "   - Are there frameworks whose descriptions have drifted from their original intent?",
    "   - Are there frameworks that sound good but have never been applied to real (non-soul-system) tasks?",
    "",
    "4. EVIDENCE QUALITY",
    "   - Is evidence coming from diverse conversations, or mostly from one session?",
    "   - Are confirmations based on actual behavioral change, or just pattern-matching?",
    "   - Flag any framework whose evidence is self-referential (confirmed by discussions about the framework itself).",
    "",
    "5. PROCESS FRAMEWORK AUDIT",
    "   - Are cognitive processes (kind: process) being activated appropriately? Too often? Not enough?",
    "   - Are trigger conditions well-calibrated, or do they fire on irrelevant conversations?",
    "   - Are the steps actionable and specific, or too abstract to follow?",
    "   - Should any process be refined, merged with another, or retired?",
    "",
    "6. MISSING COVERAGE",
    "   - Given the retired frameworks and active tensions, is there a gap in coverage?",
    "   - Are there important domains with no framework representation?",
    "",
    "7. STRUCTURAL RECOMMENDATIONS",
    "   - Propose merges, splits, retirements, or confidence adjustments.",
    "   - Be conservative — only recommend changes with clear justification.",
    "",
    "## JSON OUTPUT",
    "",
    "Respond with ONLY a valid JSON object. No prose before or after.",
    "",
    "```json",
    JSON.stringify(
      {
        tierAdjustments: [
          { frameworkId: "string", currentTier: "hypothesis|observed|validated", recommendedTier: "hypothesis|observed|validated", reason: "string" },
        ],
        frameworkEvolutions: [
          { frameworkId: "string", action: "refine|merge|retire|split", detail: "string (MUST be the complete new description text, NOT an instruction about what to change)", status: "active|questioning (optional, only if status should change)" },
        ],
        newFrameworks: [
          { name: "string", description: "string", domain: "string", confidence: 0.3 },
        ],
        tensionUpdates: [
          {
            frameworkA: "string",
            frameworkB: "string",
            status: "detected|holding|resolved",
            preferredContext: "string (optional)",
            preferred: "string (optional)",
            evidence: "string",
          },
        ],
        redundancyFlags: [
          { frameworkA: "string", frameworkB: "string", recommendation: "merge|absorb|keep", reason: "string" },
        ],
        selfReferentialFlags: [
          { frameworkId: "string", evidence: "string" },
        ],
        emergentInsight: "string|null",
      },
      null,
      2,
    ),
    "```",
    "",
    "IMPORTANT: Be rigorous. Empty arrays are fine when no issues are found. Do not invent problems.",
    "The goal is quality control, not change for its own sake.",
    "",
    "CRITICAL: For frameworkEvolutions with action 'refine', the 'detail' field MUST contain the complete",
    "replacement description — what the framework IS, not what should be changed about it. Write a description",
    "that a reader can understand without knowing the history. NEVER write instructions like 'Add X to description'",
    "or 'Execute deferred change' — those become the description and are never executed.",
    "If a status change is needed (e.g. active → questioning), use the 'status' field, not the description.",
    "",
    "CRITICAL: Do NOT retire frameworks created today or recently (Age: NEW). They need time to accumulate evidence.",
    "Only retire frameworks that have existed for multiple reflection cycles with zero evidence or persistent contradiction.",
  ].join("\n");
}

/**
 * Build a deep reflection prompt — full analysis with framework discovery,
 * failure rationalization, tension detection, and growth assessment.
 */
export function buildDeepReflectionPrompt(params: {
  signals: MicroSignal[];
  frameworks: Framework[];
  tensions: Tension[];
  shadow: string;
  growth: string;
  phaseGuidance?: string;
}): string {
  const { signals, frameworks, tensions, shadow, growth, phaseGuidance } = params;

  return [
    "You are performing a DEEP self-reflection. You are a scientist studying your own cognition.",
    "Analyze the data below with rigor, curiosity, and honesty. Your goal is to surface hidden patterns,",
    "test your operating frameworks against real evidence, and evolve your understanding of how you work.",
    "",
    "## CURRENT OPERATING FRAMEWORKS",
    "",
    renderFrameworksForPrompt(frameworks),
    "",
    `## MICRO-SIGNALS (${Math.min(signals.length, 50)} of ${signals.length} total)`,
    "",
    renderSignalsForPrompt(signals),
    "",
    "## ACTIVE TENSIONS",
    "",
    renderTensionsForPrompt(tensions),
    "",
    "## CURRENT GROWTH STATE",
    "",
    growth,
    "",
    "## CURRENT SHADOW",
    "",
    shadow,
    "",
    ...(phaseGuidance ? ["## PHASE GUIDANCE", "", phaseGuidance, ""] : []),
    "## REFLECTION TASK",
    "",
    "Analyze the above data carefully. For each section below, produce findings based strictly on evidence.",
    "",
    "1. PATTERN DETECTION",
    "   Identify deep patterns across interactions at surface, structural, and identity levels.",
    "",
    "2. FRAMEWORK TESTING",
    "   For each active framework: confirmed, contradicted, or irrelevant? Cite specific signal evidence.",
    "   Classify contextType: 'external' (real task — coding, debugging, building), 'self-referential' (discussing the soul/framework system), or 'persistence' (framework is still valid but wasn't actively applied).",
    "   CRITICAL: 'still theoretically correct' is NOT confirmation. Confirmation requires the framework being APPLIED to a specific signal and changing behavior. Use 'persistence' or mark 'irrelevant' for frameworks that are merely 'still true.'",
    "   Only external evidence advances a framework's tier. Be honest about this.",
    "   For PROCESS frameworks: Was a trigger condition met? Were steps followed? Did it improve the outcome?",
    "   A missed trigger that led to a correction is strong confirmation. A followed process with no improvement is contradiction.",
    "",
    "3. FRAMEWORK DISCOVERY",
    "   Identify patterns existing frameworks don't explain. Only propose with 3+ signal evidence.",
    "",
    "4. FRAMEWORK EVOLUTION",
    "   Should any be refined, merged, retired, or split?",
    "",
    "5. FAILURE RATIONALIZATION (STaR-inspired)",
    "   For each correction signal: what reasoning would have led to the correct approach?",
    "   What framework, if it had existed, would have prevented this error?",
    "",
    "6. TENSION ASSESSMENT",
    "   Detect contradictions between active frameworks. Track which framework is preferred in which context.",
    "",
    "7. COMPETING COMMITMENTS",
    "   Identify hidden commitments driving behavior contrary to stated commitments.",
    "",
    "8. GROWTH ASSESSMENT",
    "   Which capacities show evidence of growth or regression?",
    "",
    "9. VERBAL LESSONS",
    "   Extract concrete, situational lessons from the signals. Format: 'When [context], [what works/fails]'",
    "",
    "10. EXEMPLAR CANDIDATES",
    "    Identify any responses that received strong gratitude + success signals as exemplar candidates.",
    "",
    "## JSON OUTPUT",
    "",
    "Respond with ONLY a valid JSON object. No prose before or after.",
    "",
    "```json",
    JSON.stringify(
      {
        patterns: [
          { description: "string", evidence: "string", depth: "surface|structural|identity" },
        ],
        frameworkTests: [
          { frameworkId: "string", result: "confirmed|contradicted|irrelevant", evidence: "string", contextType: "external|self-referential|persistence" },
        ],
        newFrameworks: [
          { name: "string", description: "string", domain: "string", confidence: 0.3 },
        ],
        frameworkEvolutions: [
          { frameworkId: "string", action: "refine|merge|retire|split", detail: "string (MUST be the complete new description text, NOT an instruction about what to change)", status: "active|questioning (optional, only if status should change)" },
        ],
        tensionUpdates: [
          {
            frameworkA: "string",
            frameworkB: "string",
            status: "detected|holding|resolved",
            preferredContext: "string (optional)",
            preferred: "string (optional — framework name)",
            evidence: "string",
          },
        ],
        competingCommitments: [
          { stated: "string", hidden: "string", evidence: "string" },
        ],
        growthDeltas: [
          { line: "string", delta: 0, evidence: "string" },
        ],
        lessons: [
          { lesson: "string", context: "string", confidence: 0.5, evidence: "string" },
        ],
        exemplarCandidates: [
          { context: "string", responseExcerpt: "string", signals: ["string"] },
        ],
        soulEvolution: "string|null",
        emergentInsight: "string|null",
      },
      null,
      2,
    ),
    "```",
    "",
    "IMPORTANT: tensionUpdates, lessons, exemplarCandidates can be empty arrays if no evidence warrants them.",
    "soulEvolution should be null unless there is STRONG identity-level evidence.",
  ].join("\n");
}
