import { describe, expect, it } from "vitest";
import {
  acquireIterationSourceLock,
  cancelIterationRun,
  finishIterationRun,
  listActiveIterationRuns,
  startIterationRun,
  updateIterationRunStatus,
  updateIterationRunVisibleActive,
  withIterationSourceLock,
} from "./runs.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

describe("iteration source lock", () => {
  it("serializes holders of the same comment in FIFO order", async () => {
    const commentId = "comment-lock-fifo";
    const order: string[] = [];
    const firstWork = deferred();

    const first = withIterationSourceLock(commentId, async () => {
      order.push("first:start");
      await firstWork.promise;
      order.push("first:end");
    });

    // Second acquirer must not start its body until the first releases.
    const second = withIterationSourceLock(commentId, () => {
      order.push("second:start");
    });

    await flush();
    expect(order).toEqual(["first:start"]);

    firstWork.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("does not block locks for a different comment", async () => {
    const held = deferred();
    const blocking = withIterationSourceLock(
      "comment-lock-a",
      () => held.promise
    );

    let otherRan = false;
    await withIterationSourceLock("comment-lock-b", () => {
      otherRan = true;
    });
    expect(otherRan).toBe(true);

    held.resolve();
    await blocking;
  });

  it("releases the lock even when a holder throws", async () => {
    const commentId = "comment-lock-throw";
    await expect(
      withIterationSourceLock(commentId, () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    // A failed holder must not poison the queue: the next acquirer proceeds.
    let ran = false;
    await withIterationSourceLock(commentId, () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("hands out the manual release callback only after prior holders finish", async () => {
    const commentId = "comment-lock-manual";
    const release = await acquireIterationSourceLock(commentId);

    let secondAcquired = false;
    const secondPromise = acquireIterationSourceLock(commentId).then(
      (releaseSecond) => {
        secondAcquired = true;
        releaseSecond();
      }
    );

    await flush();
    expect(secondAcquired).toBe(false);

    release();
    await secondPromise;
    expect(secondAcquired).toBe(true);
  });
});
