import { afterEach, describe, expect, it } from "vitest";
import {
  activeIterationRunVisibleActive,
  cancelIterationRun,
  finishIterationRun,
  listActiveIterationRuns,
  startIterationRun,
  updateIterationRunStatus,
  updateIterationRunVisibleActive,
} from "./runs.ts";

const model = "composer-2.5-fast";

const startedControllers: {
  commentId: string;
  controller: AbortController;
}[] = [];

function startRun(commentId: string): AbortController {
  const controller = startIterationRun({
    anchor: `${commentId}-anchor`,
    commentId,
    count: 2,
    model,
    startedAt: 1000,
  });
  startedControllers.push({ commentId, controller });
  return controller;
}

afterEach(() => {
  for (const { commentId, controller } of startedControllers.toReversed()) {
    finishIterationRun(commentId, controller);
  }
  startedControllers.length = 0;
});

describe("iteration run registry", () => {
  it("registers active runs without exposing abort controllers", () => {
    startRun("visible-run");

    const runs = listActiveIterationRuns();

    expect(runs).toEqual([
      {
        anchor: "visible-run-anchor",
        commentId: "visible-run",
        count: 2,
        model,
        startedAt: 1000,
        status: "Agent working...",
      },
    ]);
    expect("abortController" in runs[0]).toBe(false);
  });

  it("aborts a superseded run and only lets the latest controller finish it", () => {
    const first = startRun("same-comment");
    const second = startRun("same-comment");

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);

    finishIterationRun("same-comment", first);
    expect(listActiveIterationRuns()).toHaveLength(1);

    finishIterationRun("same-comment", second);
    expect(listActiveIterationRuns()).toEqual([]);
  });

  it("updates status and visible active version for an existing run", () => {
    startRun("status-run");

    updateIterationRunStatus("status-run", "Captured screenshot");
    updateIterationRunVisibleActive("status-run", 3);

    expect(activeIterationRunVisibleActive("status-run")).toBe(3);
    expect(listActiveIterationRuns()).toMatchObject([
      {
        commentId: "status-run",
        status: "Captured screenshot",
        visibleActive: 3,
      },
    ]);
  });

  it("cancels existing runs and reports missing runs", () => {
    const controller = startRun("cancel-run");

    expect(cancelIterationRun("cancel-run")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(cancelIterationRun("missing-run")).toBe(false);
  });
});
