import type { FixModel } from "./models.ts";

/**
 * A scoped projection of agent activity for downstream progress UI.
 * Relayed to the browser as NDJSON from `POST /api/iterations/new`.
 */
export type FixProgress = {
  kind: string;
  tool?: string;
  detail?: string;
};

export type FixInput = {
  projectRoot: string;
  file: string;
  anchor: string;
  text: string;
  screenshot?: string;
  view?: string;
  model: FixModel;
  signal?: AbortSignal;
  onEvent?: (event: FixProgress) => void;
};

export type FixResult =
  | { ok: true; turnsUsed: number; toolCalls: number }
  | { ok: false; error: string };

export interface FixStrategy {
  readonly id: string;
  run(input: FixInput): Promise<FixResult>;
}

export type FixRuntimeConfig = {
  /** Path to the Cursor CLI `agent` binary. Default: `"agent"`. */
  cursorAgentPath?: string;
};
