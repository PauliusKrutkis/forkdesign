import type { AgentModel } from "../agent/models.ts";

export interface ActiveIterationRun {
  anchor: string;
  commentId: string;
  count: number;
  model: AgentModel;
  startedAt: number;
  status?: string;
  visibleActive?: number;
}

interface StoredIterationRun extends ActiveIterationRun {
  abortController: AbortController;
}

const activeRuns = new Map<string, StoredIterationRun>();

export function startIterationRun(args: {
  anchor: string;
  commentId: string;
  count: number;
  model: AgentModel;
  startedAt: number;
}): AbortController {
  const existing = activeRuns.get(args.commentId);
  existing?.abortController.abort();

  const abortController = new AbortController();
  activeRuns.set(args.commentId, {
    ...args,
    abortController,
    status: "Agent working...",
  });
  return abortController;
}

export function updateIterationRunStatus(
  commentId: string,
  status: string | undefined
): void {
  const run = activeRuns.get(commentId);
  if (!run) {
    return;
  }
  activeRuns.set(commentId, { ...run, status });
}

export function updateIterationRunVisibleActive(
  commentId: string,
  visibleActive: number
): void {
  const run = activeRuns.get(commentId);
  if (!run) {
    return;
  }
  activeRuns.set(commentId, { ...run, visibleActive });
}

export function activeIterationRunVisibleActive(
  commentId: string
): number | undefined {
  return activeRuns.get(commentId)?.visibleActive;
}

export function isIterationRunActive(commentId: string): boolean {
  return activeRuns.has(commentId);
}

export function finishIterationRun(
  commentId: string,
  abortController: AbortController
): void {
  const run = activeRuns.get(commentId);
  if (run?.abortController === abortController) {
    activeRuns.delete(commentId);
  }
}

export function cancelIterationRun(commentId: string): boolean {
  const run = activeRuns.get(commentId);
  if (!run) {
    return false;
  }
  run.abortController.abort();
  return true;
}

export function listActiveIterationRuns(): ActiveIterationRun[] {
  return [...activeRuns.values()].map(
    ({ abortController: _abortController, ...run }) => run
  );
}
