import { spawn } from "node:child_process";
import { getFixRuntimeConfig } from "../config.ts";
import { isComposerModel } from "../models.ts";
import {
  type CursorCliStreamEvent,
  countCursorCliAssistantTurn,
  countCursorCliToolStart,
  mapCursorCliError,
  projectCursorCliProgress,
} from "../progress/cursor-cli.ts";
import { buildIteratePrompt } from "../prompt.ts";
import type { FixAttemptResult, FixInput, FixStrategy } from "../types.ts";

export const cursorCliStrategy: FixStrategy = {
  id: "cursor-cli",
  run: runCursorCliFix,
};

function runCursorCliFix(input: FixInput): Promise<FixAttemptResult> {
  if (!isComposerModel(input.model)) {
    return Promise.resolve({
      ok: false,
      error: `invalid Cursor CLI model: ${input.model}`,
    });
  }

  const agentPath =
    getFixRuntimeConfig().cursorAgentPath ??
    process.env.CURSOR_AGENT_PATH ??
    "agent";
  const prompt = buildIteratePrompt(input);

  // eslint-disable-next-line no-console
  console.info(`[fix/cursor-cli] model=${input.model}`);

  let turnsUsed = 0;
  let toolCalls = 0;
  let sawResult = false;
  let resultOk = true;

  return new Promise<FixAttemptResult>((resolve) => {
    let settled = false;
    const finish = (result: FixAttemptResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const child = spawn(
      agentPath,
      [
        "-p",
        "--force",
        "--model",
        input.model,
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        prompt,
      ],
      {
        cwd: input.projectRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      }
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

    const handleStdoutLine = (line: string): void => {
      let event: CursorCliStreamEvent;
      try {
        event = JSON.parse(line) as CursorCliStreamEvent;
      } catch {
        return;
      }

      turnsUsed += countCursorCliAssistantTurn(event);
      toolCalls += countCursorCliToolStart(event);

      if (event.type === "result") {
        sawResult = true;
        const isError = (event as { is_error?: boolean }).is_error;
        if (isError === true) {
          resultOk = false;
        }
      }

      if (!input.onEvent) {
        return;
      }
      try {
        const progress = projectCursorCliProgress(event);
        if (progress) {
          input.onEvent(progress);
        }
      } catch {
        // best-effort progress
      }
    };

    const drainStdoutBuffer = (): void => {
      let nl = stdoutBuffer.indexOf("\n");
      while (nl >= 0) {
        const line = stdoutBuffer.slice(0, nl).trim();
        stdoutBuffer = stdoutBuffer.slice(nl + 1);
        nl = stdoutBuffer.indexOf("\n");
        if (line) {
          handleStdoutLine(line);
        }
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      drainStdoutBuffer();
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

      if (!(sawResult && resultOk) || (code !== null && code !== 0)) {
        finish({ ok: false, error: mapCursorCliError(stderr, code) });
        return;
      }

      finish({ ok: true, turnsUsed, toolCalls });
    });
  });
}
