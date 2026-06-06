import type { AgentProgress } from "../types.ts";

export function projectClaudeProgress(event: unknown): AgentProgress | null {
  if (!event || typeof event !== "object") {
    return null;
  }
  const t = (event as { type?: string }).type;
  if (!t) {
    return null;
  }

  if (t === "assistant") {
    const blocks = extractContentBlocks(event);
    for (const block of blocks) {
      const b = block as { type?: string; name?: string; input?: unknown };
      if (b.type === "tool_use" && typeof b.name === "string") {
        return {
          kind: t,
          tool: b.name,
          detail: extractToolDetail(b.name, b.input),
        };
      }
    }
    return { kind: t, detail: "thinking" };
  }

  if (t === "tool_use_summary") {
    const summary = (event as { summary?: string }).summary;
    return {
      kind: t,
      detail: typeof summary === "string" ? summary : undefined,
    };
  }

  return { kind: t };
}

export function countClaudeToolUseBlocks(event: unknown): number {
  const blocks = extractContentBlocks(event);
  let n = 0;
  for (const b of blocks) {
    if ((b as { type?: string }).type === "tool_use") {
      n += 1;
    }
  }
  return n;
}

function extractContentBlocks(event: unknown): unknown[] {
  const msg = (event as { message?: { content?: unknown } }).message;
  if (!msg || typeof msg !== "object") {
    return [];
  }
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content;
}

function extractToolDetail(tool: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return;
  }
  const obj = input as Record<string, unknown>;
  switch (tool) {
    case "Read":
    case "Edit":
    case "Write": {
      const p = obj.file_path ?? obj.path;
      return typeof p === "string" ? p : undefined;
    }
    case "Bash": {
      const cmd = obj.command;
      if (typeof cmd !== "string") {
        return;
      }
      return cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
    }
    case "Glob":
    case "Grep": {
      const pattern = obj.pattern ?? obj.query;
      return typeof pattern === "string" ? pattern : undefined;
    }
    default: {
      for (const key of ["file_path", "path", "command", "pattern", "query"]) {
        const v = obj[key];
        if (typeof v === "string" && v.length <= 120) {
          return v;
        }
      }
      return;
    }
  }
}
