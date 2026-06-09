import { afterEach, describe, expect, it } from "vitest";
import type { AgentModel } from "../agent/models.ts";
import {
  activeIterationRunVisibleActive,
  cancelIterationRun,
  finishIterationRun,
  listActiveIterationRuns,
  startIterationRun,
  updateIterationRunStatus,
  updateIterationRunVisibleActive,
} from "./runs.ts";

const MODEL: AgentModel = "composer-2.5-fast";

const startedRuns: { commentId: string; controller: AbortController }[] = [];

function startTrackedRun(commentId: string): AbortController {
  const controller = startIterationRun({
    anchor: `anchor-${commentId}`,
    commentId,
    count: 2,
    model: MODEL,
    startedAt: 1234,
  });
  startedRuns.push({ commentId, controller });
  return controller;
}

function runFor(commentId: string) {
  return listActiveIterationRuns().find((run) => run.commentId === commentId);
}

afterEach(() => {
  for (const { commentId, controller } of startedRuns.toReversed()) {
    finishIterationRun(commentId, controller);
  }
  startedRuns.length = 0;
});

describe("iteration run registry", () => {
  it("lists newly started runs with their default status", () => {
    startTrackedRun("comment-list");

    expect(runFor("comment-list")).toEqual({
      anchor: "anchor-comment-list",
      commentId: "comment-list",
      count: 2,
      model: MODEL,
      startedAt: 1234,
      status: "Agent working...",
    });
  });

  it("aborts an existing run when a newer run starts for the same comment", () => {
    const first = startTrackedRun("comment-restart");
    const second = startTrackedRun("comment-restart");

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(runFor("comment-restart")?.status).toBe("Agent working...");
  });

  it("cancels known runs and reports misses", () => {
    const controller = startTrackedRun("comment-cancel");

    expect(cancelIterationRun("missing-comment")).toBe(false);
    expect(cancelIterationRun("comment-cancel")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it("only finishes the active controller for a comment", () => {
    const stale = startTrackedRun("comment-finish");
    const current = startTrackedRun("comment-finish");

    finishIterationRun("comment-finish", stale);
    expect(runFor("comment-finish")).toBeDefined();

    finishIterationRun("comment-finish", current);
    expect(runFor("comment-finish")).toBeUndefined();
  });

  it("tracks visible active version and status updates", () => {
    startTrackedRun("comment-visible");

    updateIterationRunVisibleActive("comment-visible", 2);
    updateIterationRunStatus("comment-visible", "Capturing v2...");

    expect(activeIterationRunVisibleActive("comment-visible")).toBe(2);
    expect(runFor("comment-visible")).toMatchObject({
      visibleActive: 2,
      status: "Capturing v2...",
    });
  });
});
