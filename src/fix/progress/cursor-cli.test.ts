import { describe, expect, it } from "vitest";
import {
  countCursorCliToolStart,
  mapCursorCliError,
  projectCursorCliProgress,
} from "./cursor-cli.ts";

describe("projectCursorCliProgress", () => {
  it("maps read tool_call started to Read progress", () => {
    const progress = projectCursorCliProgress({
      type: "tool_call",
      subtype: "started",
      tool_call: {
        readToolCall: { args: { path: "src/pages/Home.tsx" } },
      },
    });
    expect(progress).toEqual({
      kind: "assistant",
      tool: "Read",
      detail: "src/pages/Home.tsx",
    });
  });

  it("maps write tool_call started to Edit progress", () => {
    const progress = projectCursorCliProgress({
      type: "tool_call",
      subtype: "started",
      tool_call: {
        writeToolCall: { args: { path: "src/App.tsx" } },
      },
    });
    expect(progress?.tool).toBe("Edit");
    expect(progress?.detail).toBe("src/App.tsx");
  });

  it("maps assistant events to thinking", () => {
    expect(projectCursorCliProgress({ type: "assistant" })).toEqual({
      kind: "assistant",
      detail: "thinking",
    });
  });
});

describe("countCursorCliToolStart", () => {
  it("counts tool_call started events", () => {
    expect(
      countCursorCliToolStart({ type: "tool_call", subtype: "started" }),
    ).toBe(1);
    expect(countCursorCliToolStart({ type: "assistant" })).toBe(0);
  });
});

describe("mapCursorCliError", () => {
  it("maps authentication errors", () => {
    expect(mapCursorCliError("Error: Not authenticated", 1)).toContain(
      "agent login",
    );
  });

  it("maps missing binary errors", () => {
    expect(mapCursorCliError("spawn agent ENOENT", 127)).toContain(
      "not found",
    );
  });

  it("falls back to exit code", () => {
    expect(mapCursorCliError("", 2)).toBe("Cursor CLI exited with code 2");
  });
});
