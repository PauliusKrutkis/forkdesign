import type { FixModel } from "./models.ts";

/**
 * A scoped projection of agent activity for downstream progress UI.
 * Relayed to the browser as NDJSON from `POST /api/iterations/new`.
 */
export interface FixProgress {
  detail?: string;
  kind: string;
  tool?: string;
}

export interface FixInput {
  anchor: string;
  file: string;
  model: FixModel;
  onEvent?: (event: FixProgress) => void;
  projectRoot: string;
  screenshot?: string;
  signal?: AbortSignal;
  text: string;
  view?: string;
}

export type FixResult =
  | { ok: true; turnsUsed: number; toolCalls: number }
  | { ok: false; error: string };

export interface FixStrategy {
  readonly id: string;
  run(input: FixInput): Promise<FixResult>;
}

export interface FixRuntimeConfig {
  /** Path to the Cursor CLI `agent` binary. Default: `"agent"`. */
  cursorAgentPath?: string;
}
