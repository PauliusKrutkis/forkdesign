import type { FixModel } from "./models.ts";
import type { PromptReply } from "./prompt.ts";
import type { FixSkill } from "./skills.ts";

/**
 * A scoped projection of agent activity for downstream progress UI.
 * Relayed to the browser as NDJSON from `POST /api/iterations/new`.
 */
export interface FixProgress {
  detail?: string;
  kind: string;
  tool?: string;
}

export interface FixRunInput {
  activeVersion?: number;
  anchor: string;
  file: string;
  model: FixModel;
  onEvent?: (event: FixProgress) => void;
  priorVariantApproaches?: string[];
  projectRoot: string;
  replies?: PromptReply[];
  screenshot?: string;
  signal?: AbortSignal;
  skills?: FixSkill[];
  text: string;
  variantCount?: number;
  variantIndex?: number;
  view?: string;
}

export interface FixInput extends FixRunInput {}

export type FixAttemptResult =
  | { ok: true; turnsUsed: number; toolCalls: number }
  | { ok: false; error: string };

/** Per-model timing for one attempt in the fallback chain. */
export interface FixAttemptTiming {
  model: FixModel;
  ms: number;
  ok: boolean;
}

export type FixResult =
  | {
      ok: true;
      modelUsed: FixModel;
      turnsUsed: number;
      toolCalls: number;
      attempts: FixAttemptTiming[];
    }
  | {
      ok: false;
      error: string;
      modelsTried?: FixModel[];
      attempts: FixAttemptTiming[];
    };

export interface FixStrategy {
  readonly id: string;
  run(input: FixInput): Promise<FixAttemptResult>;
}

export interface FixRuntimeConfig {
  /** Path to the Cursor CLI `agent` binary. Default: `"agent"`. */
  cursorAgentPath?: string;
  /** Override the default Fix model fallback order. */
  fixModelPriority?: FixModel[];
  /**
   * Skill guidance injected into generated fix prompts by default.
   * Use an empty array to disable default skill guidance.
   */
  fixSkills?: FixSkill[];
}
