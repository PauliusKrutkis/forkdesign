import { describe, expect, it } from "vitest";
import {
  cancelIterationRun,
  finishIterationRun,
  listActiveIterationRuns,
  startIterationRun,
  updateIterationRunStatus,
  updateIterationRunVisibleActive,
} from "./runs.ts";

describe("active iteration runs", () => {
  it("replaces duplicate runs and ignores stale finish calls", () => {
    const commentId = "comment-runs-replace";
    const first = startIterationRun({
      anchor: "anchor-a",
      commentId,
      count: 1,
      model: "composer-2.5-fast",
      startedAt: 100,
    });

    let second: AbortController | undefined;
    try {
      second = startIterationRun({
        anchor: "anchor-a",
        commentId,
        count: 2,
        model: "composer-2.5",
        startedAt: 200,
      });

      expect(first.signal.aborted).toBe(true);

      finishIterationRun(commentId, first);
      updateIterationRunStatus(commentId, "Applying variant");
      updateIterationRunVisibleActive(commentId, 2);

      expect(listActiveIterationRuns()).toContainEqual({
        anchor: "anchor-a",
        commentId,
        count: 2,
        model: "composer-2.5",
        startedAt: 200,
        status: "Applying variant",
        visibleActive: 2,
      });

      expect(cancelIterationRun(commentId)).toBe(true);
      expect(second.signal.aborted).toBe(true);
      finishIterationRun(commentId, second);
      expect(cancelIterationRun(commentId)).toBe(false);
    } finally {
      finishIterationRun(commentId, first);
      if (second) {
        finishIterationRun(commentId, second);
      }
    }
  });
});
