export type SoulConfig = {
  signals: {
    enabled: boolean;
    maxLogSizeKb: number;
  };
  selfEvaluation: {
    enabled: boolean;
    weight: number;
  };
  stateEngine: {
    enabled: boolean;
  };
  reflection: {
    enabled: boolean;
    quickSignalThreshold: number;
    deepSignalThreshold: number;
    quickIntervalMs: number;
    deepIntervalMs: number;
    quickModel: string;
    deepModel: string;
  };
  exemplars: {
    enabled: boolean;
    maxCount: number;
    maxInjectCount: number;
  };
  lessons: {
    enabled: boolean;
    maxCount: number;
    maxInjectCount: number;
  };
  contextBudget: {
    maxTokens: number;
  };
  tensions: {
    enabled: boolean;
  };
  metaOptimization: {
    enabled: boolean;
  };
  writeProtection: {
    enabled: boolean;
  };
};

export const DEFAULT_CONFIG: SoulConfig = {
  signals: { enabled: true, maxLogSizeKb: 50 },
  selfEvaluation: { enabled: true, weight: 0.5 },
  stateEngine: { enabled: true },
  reflection: {
    enabled: true,
    quickSignalThreshold: 20,
    deepSignalThreshold: 100,
    quickIntervalMs: 1800000,
    deepIntervalMs: 10800000,
    quickModel: "haiku",
    deepModel: "sonnet",
  },
  exemplars: { enabled: true, maxCount: 50, maxInjectCount: 2 },
  lessons: { enabled: true, maxCount: 100, maxInjectCount: 3 },
  contextBudget: { maxTokens: 4500 },
  tensions: { enabled: true },
  metaOptimization: { enabled: true },
  writeProtection: { enabled: true },
};
