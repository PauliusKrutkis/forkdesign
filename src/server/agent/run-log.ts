import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/** Per-model timing for one attempt inside an agent run's fallback chain. */
interface AgentAttemptLog {
  model: string;
  ms: number;
  ok: boolean;
}

/**
 * One record per Agent run, appended as a JSONL line. Designed to be read back
 * (by a human or an AI) to diagnose latency: each line is a self-contained
 * snapshot of what the agent did and how long each part took.
 */
export interface AgentRunLogEntry {
  /** `data-comment-anchor` value used to locate the element. */
  anchor: string;
  /** Per-model timing for each attempt in the chain. */
  attempts?: AgentAttemptLog[];
  /** Did the run actually change the source? (null when not reached.) */
  changed?: boolean | null;
  /** Comment id the agent run was for. */
  comment: string;
  /** Total wall-clock from dispatch to terminal state. */
  durationMs: number;
  /** Error message on the failure path. */
  error?: string | null;
  /** Source file (relative to project root) that was targeted. */
  file: string;
  /** Resolved fallback chain that was eligible to run. */
  modelChain: string[];
  /** Model the client asked for. */
  modelRequested: string;
  /** Models attempted before giving up (failure path). */
  modelsTried?: string[];
  /** Model that actually produced the result (undefined on failure). */
  modelUsed?: string | null;
  /** Did the run complete without error? */
  ok: boolean;
  /** Whether the screenshot was offered to the model for this run. */
  screenshotIncluded: boolean;
  /** Where the run ended: before-read | agent | after-read | version | persist | done. */
  stage: string;
  /** Length of the user's feedback text (proxy for prompt size). */
  textLength: number;
  /** Tool calls (Read/Edit) made by the winning attempt. */
  toolCalls?: number | null;
  /** ISO timestamp when the run finished. */
  ts: string;
  /** Agent turns consumed by the winning attempt. */
  turnsUsed?: number | null;
  /** Total variants requested for this Agent run. */
  variantCount?: number;
  /** 1-based index when generating multiple independent variants. */
  variantIndex?: number;
}

function agentLogPath(projectRoot: string): string {
  return path.join(projectRoot, "designs", "logs", "agent-runs.jsonl");
}

/**
 * Append an agent-run record as one JSONL line. Best-effort: logging must never
 * break or slow down the agent run itself, so failures are swallowed with a warning.
 */
export async function appendAgentRunLog(
  projectRoot: string,
  entry: AgentRunLogEntry
): Promise<void> {
  try {
    const file = agentLogPath(projectRoot);
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (err) {
    console.warn(
      `[agent-log] failed to write run log: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
