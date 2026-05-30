import { spawn } from "node:child_process";
import { buildIteratePrompt } from "../prompt.ts";
import {
  countCursorCliAssistantTurn,
  countCursorCliToolStart,
  mapCursorCliError,
  projectCursorCliProgress,
  type CursorCliStreamEvent,
} from "../progress/cursor-cli.ts";
import type { FixInput, FixResult, FixStrategy } from "../types.ts";
import { getFixRuntimeConfig } from "../config.ts";

export const cursorCliStrategy: FixStrategy = {
  id: "cursor-cli",
  run: runCursorCliFix,
};

async function runCursorCliFix(input: FixInput): Promise<FixResult> {
  const agentPath =
    getFixRuntimeConfig().cursorAgentPath ??
    process.env.CURSOR_AGENT_PATH ??
    "agent";
  const prompt = buildIteratePrompt(input);

  let turnsUsed = 0;
  let toolCalls = 0;
  let sawResult = false;
  let resultOk = true;

  return new Promise<FixResult>((resolve) => {
    let settled = false;
    const finish = (result: FixResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const child = spawn(
      agentPath,
      [
        "-p",
        "--force",
        "--model",
        "composer-2.5",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        prompt,
      ],
      {
        cwd: input.projectRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    let stdoutBuffer = "";

    const onAbort = () => {
      child.kill("SIGTERM");
      finish({ ok: false, error: "aborted" });
    };

    if (input.signal) {
      if (input.signal.aborted) {
        onAbort();
        return;
      }
      input.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, nl).trim();
        stdoutBuffer = stdoutBuffer.slice(nl + 1);
        if (!line) continue;

        let event: CursorCliStreamEvent;
        try {
          event = JSON.parse(line) as CursorCliStreamEvent;
        } catch {
          continue;
        }

        turnsUsed += countCursorCliAssistantTurn(event);
        toolCalls += countCursorCliToolStart(event);

        if (event.type === "result") {
          sawResult = true;
          const isError = (event as { is_error?: boolean }).is_error;
          if (isError === true) resultOk = false;
        }

        if (input.onEvent) {
          try {
            const progress = projectCursorCliProgress(event);
            if (progress) input.onEvent(progress);
          } catch {
            // best-effort progress
          }
        }
      }
    });

    child.on("error", (err) => {
      input.signal?.removeEventListener("abort", onAbort);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        finish({
          ok: false,
          error:
            "Cursor CLI (`agent`) not found — install from https://cursor.com/docs/cli and ensure it is on PATH",
        });
        return;
      }
      finish({ ok: false, error: err.message });
    });

    child.on("close", (code) => {
      input.signal?.removeEventListener("abort", onAbort);

      if (input.signal?.aborted) {
        finish({ ok: false, error: "aborted" });
        return;
      }

      if (!sawResult || !resultOk || (code !== null && code !== 0)) {
        finish({ ok: false, error: mapCursorCliError(stderr, code) });
        return;
      }

      finish({ ok: true, turnsUsed, toolCalls });
    });
  });
}
