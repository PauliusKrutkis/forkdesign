import type { FixProgress } from "../types.ts";

export interface CursorCliStreamEvent {
  subtype?: string;
  tool_call?: Record<string, unknown>;
  type?: string;
}

export function projectCursorCliProgress(
  event: CursorCliStreamEvent
): FixProgress | null {
  const t = event.type;
  if (!t) {
    return null;
  }

  if (t === "tool_call" && event.subtype === "started") {
    const toolCall = event.tool_call;
    if (!toolCall || typeof toolCall !== "object") {
      return { kind: t, detail: "tool" };
    }

    const read = toolCall.readToolCall as
      | { args?: { path?: string } }
      | undefined;
    if (read) {
      return {
        kind: "assistant",
        tool: "Read",
        detail: read.args?.path,
      };
    }

    const write = toolCall.writeToolCall as
      | { args?: { path?: string } }
      | undefined;
    if (write) {
      return {
        kind: "assistant",
        tool: "Edit",
        detail: write.args?.path,
      };
    }

    const edit = toolCall.editToolCall as
      | { args?: { path?: string } }
      | undefined;
    if (edit) {
      return {
        kind: "assistant",
        tool: "Edit",
        detail: edit.args?.path,
      };
    }

    const glob = toolCall.globToolCall as
      | { args?: { pattern?: string } }
      | undefined;
    if (glob) {
      return {
        kind: "assistant",
        tool: "Glob",
        detail: glob.args?.pattern,
      };
    }

    const grep = toolCall.grepToolCall as
      | { args?: { pattern?: string } }
      | undefined;
    if (grep) {
      return {
        kind: "assistant",
        tool: "Grep",
        detail: grep.args?.pattern,
      };
    }

    return { kind: t, detail: "tool" };
  }

  if (t === "assistant") {
    return { kind: t, detail: "thinking" };
  }

  return { kind: t };
}

export function countCursorCliToolStart(event: CursorCliStreamEvent): number {
  return event.type === "tool_call" && event.subtype === "started" ? 1 : 0;
}

export function countCursorCliAssistantTurn(
  event: CursorCliStreamEvent
): number {
  return event.type === "assistant" ? 1 : 0;
}

export function mapCursorCliError(
  stderr: string,
  exitCode: number | null
): string {
  const combined = stderr.trim();
  const lower = combined.toLowerCase();

  if (
    lower.includes("not authenticated") ||
    lower.includes("invalid api key") ||
    lower.includes("authentication required")
  ) {
    return "Cursor CLI not authenticated — run `agent login` or set CURSOR_API_KEY";
  }

  if (
    lower.includes("enoent") ||
    lower.includes("command not found") ||
    lower.includes("not found")
  ) {
    return "Cursor CLI (`agent`) not found — install from https://cursor.com/docs/cli and ensure it is on PATH";
  }

  if (combined.length > 0) {
    return combined.length > 500 ? `${combined.slice(0, 497)}...` : combined;
  }

  if (exitCode !== null && exitCode !== 0) {
    return `Cursor CLI exited with code ${exitCode}`;
  }

  return "Cursor CLI failed";
}
