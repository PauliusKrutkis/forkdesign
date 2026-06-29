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

export function hasActiveIterationRun(commentId: string): boolean {
  return activeRuns.has(commentId);
}

/**
 * Per-comment FIFO mutex over the live source tree. The agent's variant loop
 * holds it while generating/persisting/capturing each variant; the activate and
 * delete endpoints acquire it before rewriting the source file. This is what
 * lets a user switch to a finished version mid-run without clobbering the
 * variant the agent is editing: the switch simply applies at the next gap
 * between variants instead of being rejected outright.
 *
 * Locks are independent per comment, so concurrent runs on different comments
 * never wait on each other.
 */
const sourceLockChains = new Map<string, Promise<void>>();

export function acquireIterationSourceLock(
  commentId: string
): Promise<() => void> {
  const prev = sourceLockChains.get(commentId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The tail resolves only once this holder calls release(), so the next
  // acquirer's `prev` makes it wait. Each comment keeps a single, replaceable
  // entry — no unbounded growth across repeated locks.
  sourceLockChains.set(
    commentId,
    prev.then(() => next)
  );
  return prev.then(() => release);
}

export async function withIterationSourceLock<T>(
  commentId: string,
  fn: () => T | Promise<T>
): Promise<T> {
  const release = await acquireIterationSourceLock(commentId);
  try {
    return await fn();
  } finally {
    release();
  }
}

export function listActiveIterationRuns(): ActiveIterationRun[] {
  return [...activeRuns.values()].map(
    ({ abortController: _abortController, ...run }) => run
  );
}
