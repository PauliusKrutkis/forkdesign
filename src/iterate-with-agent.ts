/**
 * Close-the-loop AI invocation for the comment-bubble system.
 *
 * Given a comment (text + anchor + file + optional screenshot/view), invokes
 * the Claude Agent SDK with a structured prompt instructing the agent to
 * address the feedback. The agent runs with `acceptEdits` permissions so it
 * can read/edit files in the project without per-tool prompts.
 *
 * Returns a `Result` with `changed`/`turnsUsed` on success or an `error`
 * string on failure. The handler is responsible for capturing the
 * before/after source diff — this helper just runs the agent.
 *
 * Authentication: the SDK reads credentials from the user's environment.
 * In order of precedence: cloud provider env vars → ANTHROPIC_API_KEY →
 * subscription OAuth in ~/.claude/.credentials.json (or OS keychain).
 * No credential code here.
 */

import path from "node:path";
import { AbortError, query, type Options } from "@anthropic-ai/claude-agent-sdk";

/**
 * A scoped, network-cheap projection of an SDK event for downstream progress
 * UI. We deliberately don't surface the entire raw `SDKMessage` — it carries
 * full Beta API content blocks, transcripts, and metadata that the client
 * doesn't need. The handler relays these to the browser as NDJSON.
 */
export type IterateProgress = {
  /** Original SDK message `type` (e.g. `assistant`, `tool_use_summary`, `user`). */
  kind: string;
  /** Tool name when we can extract one (e.g. `Read`, `Edit`, `Glob`). */
  tool?: string;
  /** Short human-readable detail (file path, command, "thinking..."). */
  detail?: string;
};

export type IterateInput = {
  /** Absolute path to the project root. SDK runs with this as cwd. */
  projectRoot: string;
  /** Project-relative path of the file containing the comment marker. */
  file: string;
  /** UUID of the anchored element (`data-comment-anchor="<uuid>"`). */
  anchor: string;
  /** Body text of the comment. */
  text: string;
  /** Optional URL path of the at-comment-time screenshot. */
  screenshot?: string;
  /** Optional view slug (the nearest `data-view` ancestor). */
  view?: string;
  /** Optional abort signal. Aborting throws AbortError out of the iterator. */
  signal?: AbortSignal;
  /**
   * Optional progress callback invoked once per SDK event. Errors thrown from
   * the callback are swallowed — progress reporting is best-effort and must
   * never derail the agent loop.
   */
  onEvent?: (event: IterateProgress) => void;
};

export type IterateResult =
  | { ok: true; turnsUsed: number; toolCalls: number }
  | { ok: false; error: string };

/**
 * Run the agent until completion. Caller compares file content before/after
 * to determine whether any change actually happened.
 */
export async function iterateWithAgent(input: IterateInput): Promise<IterateResult> {
  const prompt = buildIteratePrompt(input);

  const abortController = new AbortController();
  if (input.signal) {
    if (input.signal.aborted) abortController.abort();
    else input.signal.addEventListener("abort", () => abortController.abort(), { once: true });
  }

  const options: Options = {
    cwd: input.projectRoot,
    permissionMode: "acceptEdits",
    abortController,
    maxTurns: 30,
    allowedTools: ["Read", "Edit", "Glob", "Grep"],
  };

  let turnsUsed = 0;
  let toolCalls = 0;

  try {
    for await (const event of query({ prompt, options })) {
      const t = (event as { type?: string }).type;
      if (t === "assistant") {
        turnsUsed += 1;
        toolCalls += countToolUseBlocks(event);
      }
      // eslint-disable-next-line no-console
      console.info(`[claude-agent] ${t ?? "event"}`);

      if (input.onEvent) {
        try {
          const progress = projectProgress(event);
          if (progress) input.onEvent(progress);
        } catch {
          // never let progress reporting derail the loop
        }
      }
    }
  } catch (err) {
    if (err instanceof AbortError) return { ok: false, error: "aborted" };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true, turnsUsed, toolCalls };
}

// ---------------------------------------------------------------------------
// Progress projection helpers
//
// The Agent SDK emits a stream of `SDKMessage`s — `assistant`, `user`,
// `tool_use_summary`, `system`, and a handful of bookkeeping types. We only
// pluck a small projection: the kind, the tool name (for tool calls), and a
// short detail string. Anything richer than that is too noisy for a live
// status line.
// ---------------------------------------------------------------------------

function projectProgress(event: unknown): IterateProgress | null {
  if (!event || typeof event !== "object") return null;
  const t = (event as { type?: string }).type;
  if (!t) return null;

  if (t === "assistant") {
    const blocks = extractContentBlocks(event);
    // Prefer surfacing a tool call over assistant text: it's what the user
    // wants to see ("Read foo.tsx") rather than chain-of-thought prose.
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
    // Fall back to a "thinking" marker so the UI shows movement even on
    // turns where the model emitted text but didn't call a tool.
    return { kind: t, detail: "thinking" };
  }

  if (t === "tool_use_summary") {
    const summary = (event as { summary?: string }).summary;
    return { kind: t, detail: typeof summary === "string" ? summary : undefined };
  }

  // Other event types (user, system, hooks, etc.) — emit a thin trace so the
  // client can show "something happened" but skip detail extraction.
  return { kind: t };
}

function extractContentBlocks(event: unknown): unknown[] {
  const msg = (event as { message?: { content?: unknown } }).message;
  if (!msg || typeof msg !== "object") return [];
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content;
}

function countToolUseBlocks(event: unknown): number {
  const blocks = extractContentBlocks(event);
  let n = 0;
  for (const b of blocks) {
    if ((b as { type?: string }).type === "tool_use") n += 1;
  }
  return n;
}

function extractToolDetail(tool: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
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
      if (typeof cmd !== "string") return undefined;
      return cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
    }
    case "Glob":
    case "Grep": {
      const pattern = obj.pattern ?? obj.query;
      return typeof pattern === "string" ? pattern : undefined;
    }
    default: {
      // Best-effort: surface any short string field that looks like a path.
      for (const key of ["file_path", "path", "command", "pattern", "query"]) {
        const v = obj[key];
        if (typeof v === "string" && v.length <= 120) return v;
      }
      return undefined;
    }
  }
}

function buildIteratePrompt(input: IterateInput): string {
  const parts: string[] = [];

  parts.push(
    "You are addressing inline design feedback from a user in a React + Tailwind design playground.",
    "",
    "## Feedback",
    `"${input.text}"`,
    "",
    "## Location",
    `File: ${input.file}`,
    `Element anchor: \`data-comment-anchor="${input.anchor}"\``,
    "Find the element by searching for the anchor attribute in the file. Modify code AROUND that element to address the feedback.",
  );

  if (input.screenshot) {
    // The screenshot URL on the wire is `/designs/iterations/<id>/v0.png`.
    // On disk it's served from `<projectRoot>/public/designs/...` via a symlink
    // to `<projectRoot>/designs/...`. Either path resolves to the same file;
    // give the agent the public/ form so it's a single canonical absolute path.
    const absScreenshot = path.join(
      input.projectRoot,
      "public",
      input.screenshot.replace(/^\//, ""),
    );
    parts.push(
      "",
      "## Visual context",
      `Screenshot taken at the time of feedback: \`${absScreenshot}\``,
      "Read this image to see what the user is looking at when they wrote the feedback.",
    );
  }

  if (input.view) {
    parts.push("", "## View context", `The element is inside the \`data-view="${input.view}"\` region.`);
  }

  parts.push(
    "",
    "## Constraints (from CLAUDE.md and the comment-bubble system)",
    "- Do NOT remove or modify the `{/* @comment ... */}` block — it's preserved human feedback.",
    "- Do NOT change the `data-comment-anchor` attribute value.",
    "- Follow the host app's existing Tailwind/shadcn tokens (`bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`, etc.).",
    "- Make focused changes. Don't rewrite unrelated parts of the file.",
    "- Don't run tests or builds — the user verifies visually.",
    "",
    "Now read the file, locate the element by its anchor, and apply the changes. Once you're satisfied, stop.",
  );

  return parts.join("\n");
}
