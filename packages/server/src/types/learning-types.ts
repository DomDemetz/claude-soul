export type EvidenceTier = "hypothesis" | "observed" | "validated";

export type FrameworkKind = "mental-model" | "process";

export type Framework = {
  id: string;
  name: string;
  description: string;
  source: "seed" | "discovered" | "evolved" | "merged";
  confidence: number;
  evidenceTier: EvidenceTier;
  evidence: FrameworkEvidence[];
  domain: string;
  kind: FrameworkKind;
  triggers?: string[];
  steps?: string[];
  relatedFrameworks: string[];
  contradicts: string[];
  supersedes: string[];
  workflows: Workflow[];
  createdAt: number;
  lastTestedAt: number;
  applicationCount: number;
  version: number;
  status: "active" | "questioning" | "retired" | "merged";
};

export type EvidenceContext = "external" | "self-referential" | "persistence" | "unknown";

export type FrameworkEvidence = {
  timestamp: number;
  type: "confirmed" | "contradicted" | "refined";
  context: string;
  contextType?: EvidenceContext;
};

export type Workflow = {
  id: string;
  name: string;
  trigger: string;
  steps: WorkflowStep[];
  source: "seed" | "discovered" | "evolved";
  confidence: number;
  executionCount: number;
  successRate: number;
  lastExecutedAt: number;
  version: number;
  status: "active" | "testing" | "retired";
};

export type WorkflowStep = {
  order: number;
  action: string;
  condition?: string;
  output?: string;
  duration?: string;
};

export type FrameworkStore = {
  version: 1;
  schemaVersion?: number;
  frameworks: Framework[];
  meta: {
    totalDiscovered: number;
    totalRetired: number;
    totalMerged: number;
    lastReflectionAt: number;
    reflectionCount: number;
  };
};

export type MicroSignal = {
  timestamp: number;
  sessionKey: string;
  type: SignalType;
  evidence: string;
  source: "user" | "self";
  confidence: number;
  userSnippets: string[];
  assistantSnippets: string[];
};

export type SignalType =
  | "correction"
  | "rephrasing"
  | "gratitude"
  | "disengagement"
  | "topic_shift"
  | "depth_change"
  | "success"
  | "confusion";

export type Tension = {
  id: string;
  frameworkA: string;
  frameworkB: string;
  description: string;
  preferredInContext: Record<
    string,
    {
      preferred: string;
      confirmedCount: number;
      evidence: string[];
    }
  >;
  status: "detected" | "holding" | "resolved" | "integrated";
  detectedAt: number;
  resolvedAt?: number;
};

export type TensionState = {
  tensions: Tension[];
};

export type LLMReflectionResult = {
  patterns: Array<{
    description: string;
    evidence: string;
    depth: "surface" | "structural" | "identity";
  }>;
  frameworkTests: Array<{
    frameworkId: string;
    result: "confirmed" | "contradicted" | "irrelevant";
    evidence: string;
  }>;
  newFrameworks: Array<{
    name: string;
    description: string;
    domain: string;
    confidence: number;
  }>;
  frameworkEvolutions: Array<{
    frameworkId: string;
    action: "refine" | "merge" | "retire" | "split";
    detail: string;
  }>;
  tensionUpdates: Array<{
    tensionId?: string;
    frameworkA: string;
    frameworkB: string;
    status: Tension["status"];
    preferredContext?: string;
    preferred?: string;
    evidence: string;
  }>;
  competingCommitments: Array<{
    stated: string;
    hidden: string;
    evidence: string;
  }>;
  growthDeltas: Array<{
    line: string;
    delta: number;
    evidence: string;
  }>;
  soulEvolution: string | null;
  emergentInsight: string | null;
};

export type FrameworkSeed = Omit<
  Framework,
  "id" | "createdAt" | "lastTestedAt"
>;

export type Exemplar = {
  id: string;
  context: string;
  responseExcerpt: string;
  frameworksActive: string[];
  domain: string;
  signals: string[];
  createdAt: number;
};

export type Lesson = {
  id: string;
  lesson: string;
  context: string;
  confidence: number;
  evidence: string[];
  createdAt: number;
  lastConfirmed?: number;
};

export type InternalState = {
  energy: number;
  mood: number;
  confidence: number;
  socialCharge: number;
  curiosity: number;
  frustration: number;
  hoursActive: number;
  lastSuccessMinAgo: number;
  lastFailureMinAgo: number;
  lastTickAt: number;
};
