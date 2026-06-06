import type { AgentModel } from "./models.ts";
import type { PromptReply } from "./prompt.ts";
import type { AgentSkill } from "./skills.ts";

/**
 * A scoped projection of agent activity for downstream progress UI.
 * Relayed to the browser as NDJSON from `POST /api/iterations/new`.
 */
export interface AgentProgress {
  detail?: string;
  kind: string;
  tool?: string;
}

export interface AgentRunInput {
  activeVersion?: number;
  anchor: string;
  file: string;
  model: AgentModel;
  onEvent?: (event: AgentProgress) => void;
  priorVariantApproaches?: string[];
  projectRoot: string;
  replies?: PromptReply[];
  screenshot?: string;
  signal?: AbortSignal;
  skills?: AgentSkill[];
  text: string;
  variantCount?: number;
  variantIndex?: number;
  view?: string;
}

export interface AgentInput extends AgentRunInput {}

export type AgentAttemptResult =
  | { ok: true; turnsUsed: number; toolCalls: number }
  | { ok: false; error: string };

/** Per-model timing for one attempt in the fallback chain. */
export interface AgentAttemptTiming {
  model: AgentModel;
  ms: number;
  ok: boolean;
}

export type AgentResult =
  | {
      ok: true;
      modelUsed: AgentModel;
      turnsUsed: number;
      toolCalls: number;
      attempts: AgentAttemptTiming[];
    }
  | {
      ok: false;
      error: string;
      modelsTried?: AgentModel[];
      attempts: AgentAttemptTiming[];
    };

export interface AgentStrategy {
  readonly id: string;
  run(input: AgentInput): Promise<AgentAttemptResult>;
}

export interface AgentRuntimeConfig {
  /** Override the default Agent model fallback order. */
  agentModelPriority?: AgentModel[];
  /**
   * Skill guidance injected into generated agent prompts by default.
   * Use an empty array to disable default skill guidance.
   */
  agentSkills?: AgentSkill[];
  /** Path to the Cursor CLI `agent` binary. Default: `"agent"`. */
  cursorAgentPath?: string;
}
