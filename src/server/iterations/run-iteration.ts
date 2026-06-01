import { copyFile, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { FoundComment } from "../comments/find-comment.ts";
import { updateCommentActive } from "../comments/writer.ts";
import { WriteError } from "../comments/writer-errors.ts";
import { getFixRuntimeConfig } from "../fix/config.ts";
import { runFix } from "../fix/index.ts";
import {
  buildFixModelChain,
  DEFAULT_FIX_MODEL_PRIORITY,
  type FixModel,
} from "../fix/models.ts";
import {
  shouldIncludeScreenshotInPrompt,
  summarizeFixSourceDiff,
} from "../fix/prompt.ts";
import { appendFixRunLog } from "../fix/run-log.ts";
import type { FixAttemptTiming } from "../fix/types.ts";
import { atomicWriteText } from "../platform/atomic-write.ts";
import { errorMessage } from "../platform/http.ts";
import {
  findVersionPngPath,
  iterationPngUrl,
  nextIterationVersion,
  patchIterationsManifest,
  pngMtimeMs,
  resolveIterationDirRoots,
} from "./manifest.ts";

export interface NdjsonStream {
  abortController: AbortController;
  clientGone: () => boolean;
  endStream: (final: object) => void;
  writeEvent: (event: object) => void;
}

export function createNdjsonStream(
  req: IncomingMessage,
  res: ServerResponse
): NdjsonStream {
  const abortController = new AbortController();
  let clientGone = false;
  const onClose = () => {
    if (clientGone) {
      return;
    }
    clientGone = true;
    abortController.abort();
  };
  req.on("close", onClose);

  const writeEvent = (event: object): void => {
    if (clientGone || res.destroyed) {
      return;
    }
    try {
      res.write(`${JSON.stringify(event)}\n`);
    } catch {
      clientGone = true;
      abortController.abort();
    }
  };

  const endStream = (final: object): void => {
    writeEvent(final);
    try {
      res.end();
    } catch {
      /* socket already closed */
    }
  };

  return {
    writeEvent,
    endStream,
    abortController,
    clientGone: () => clientGone,
  };
}

export function openNdjsonResponse(res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.flushHeaders?.();
}

function activeUpdateErrorMessage(err: unknown): string {
  if (err instanceof WriteError) {
    return err.message;
  }
  return errorMessage(err);
}

function variantProgressPrefix(variantIndex: number, count: number): string {
  return count > 1 ? `variant ${variantIndex}/${count} — ` : "";
}

async function persistNewIterationSnapshot(
  found: FoundComment,
  id: string,
  iterDir: string,
  nextV: number,
  afterSource: string,
  iterationRoots: string[],
  lastAgentSummary: string | undefined,
  stream: NdjsonStream,
  options: { setActive: boolean; variantPrefix: string }
): Promise<{ ok: true; png: string } | { ok: false; error: string }> {
  const nextTsx = path.join(iterDir, `v${nextV}.tsx`);
  const nextPng = path.join(iterDir, `v${nextV}.png`);

  stream.writeEvent({
    type: "progress",
    stage: "snapshot",
    detail: `${options.variantPrefix}writing v${nextV}.tsx`,
  });

  try {
    await atomicWriteText(nextTsx, afterSource);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }

  try {
    const v0Png = findVersionPngPath(iterationRoots, 0);
    if (v0Png) {
      await copyFile(v0Png, nextPng);
    }
  } catch (err) {
    console.warn(
      `[vite-plugin-comments] failed to copy v0.png → v${nextV}.png: ${errorMessage(err)}`
    );
  }

  if (options.setActive) {
    stream.writeEvent({
      type: "progress",
      stage: "snapshot",
      detail: `${options.variantPrefix}setting active=${nextV}`,
    });

    try {
      await updateCommentActive({
        absolutePath: found.absolutePath,
        commentId: id,
        active: nextV,
      });
    } catch (err) {
      return { ok: false, error: activeUpdateErrorMessage(err) };
    }
  }

  try {
    const summary = lastAgentSummary?.trim() || `Fix v${nextV}`;
    await patchIterationsManifest(iterDir, nextV, {
      summary,
      createdAt: new Date().toISOString(),
    });
  } catch (manifestErr) {
    console.warn(
      `[vite-plugin-comments] failed to write iteration manifest: ${errorMessage(manifestErr)}`
    );
  }

  return {
    ok: true,
    png: iterationPngUrl(id, nextV, pngMtimeMs(iterationRoots, nextV)),
  };
}

export interface RunNewIterationInput {
  count: number;
  found: FoundComment;
  id: string;
  model: FixModel;
  projectRoot: string;
  stream: NdjsonStream;
}

interface VariantRunOutcome {
  afterSource?: string;
  attempts?: FixAttemptTiming[];
  changed: boolean;
  error?: string;
  modelUsed?: FixModel;
  ok: boolean;
  stage: string;
  toolCalls?: number;
  turnsUsed?: number;
}

async function runSingleFixVariant(args: {
  beforeSource: string;
  count: number;
  found: FoundComment;
  model: FixModel;
  priorVariantApproaches: string[];
  projectRoot: string;
  stream: NdjsonStream;
  variantIndex: number;
}): Promise<{ result: VariantRunOutcome; lastAgentSummary?: string }> {
  const {
    beforeSource,
    count,
    found,
    model,
    priorVariantApproaches,
    projectRoot,
    stream,
    variantIndex,
  } = args;
  const variantPrefix = variantProgressPrefix(variantIndex, count);

  try {
    await atomicWriteText(found.absolutePath, beforeSource);
  } catch (err) {
    return {
      result: {
        ok: false,
        changed: false,
        stage: "restore",
        error: errorMessage(err),
      },
    };
  }

  stream.writeEvent({
    type: "progress",
    stage: "agent",
    detail: `${variantPrefix}dispatching`,
  });

  let lastAgentSummary: string | undefined;
  const agentResult = await runFix({
    projectRoot,
    file: found.relativePath,
    anchor: found.comment.anchor,
    text: found.comment.text,
    screenshot: found.comment.screenshot,
    view: found.comment.view,
    activeVersion: found.comment.active ?? 0,
    replies: found.comment.replies,
    model,
    variantIndex,
    variantCount: count,
    priorVariantApproaches:
      priorVariantApproaches.length > 0 ? priorVariantApproaches : undefined,
    signal: stream.abortController.signal,
    onEvent: (e) => {
      if (e.kind === "tool_use_summary" && e.detail) {
        lastAgentSummary = e.detail;
      } else if (e.detail) {
        lastAgentSummary = lastAgentSummary ?? e.detail;
      }
      stream.writeEvent({
        type: "progress",
        stage: "agent",
        ...(e.tool ? { tool: e.tool } : {}),
        ...(e.detail ? { detail: `${variantPrefix}${e.detail}` } : {}),
      });
    },
  });

  if (!agentResult.ok) {
    return {
      result: {
        ok: false,
        changed: false,
        stage: "agent",
        error: agentResult.error,
        attempts: agentResult.attempts,
      },
    };
  }

  stream.writeEvent({
    type: "progress",
    stage: "snapshot",
    detail: `${variantPrefix}reading post-edit source`,
  });

  let afterSource: string;
  try {
    afterSource = await readFile(found.absolutePath, "utf8");
  } catch (err) {
    return {
      result: {
        ok: false,
        changed: false,
        stage: "after-read",
        error: errorMessage(err),
        modelUsed: agentResult.modelUsed,
        turnsUsed: agentResult.turnsUsed,
        toolCalls: agentResult.toolCalls,
        attempts: agentResult.attempts,
      },
      lastAgentSummary,
    };
  }

  if (afterSource === beforeSource) {
    return {
      result: {
        ok: true,
        changed: false,
        stage: "done",
        modelUsed: agentResult.modelUsed,
        turnsUsed: agentResult.turnsUsed,
        toolCalls: agentResult.toolCalls,
        attempts: agentResult.attempts,
      },
      lastAgentSummary,
    };
  }

  return {
    result: {
      ok: true,
      changed: true,
      stage: "done",
      afterSource,
      modelUsed: agentResult.modelUsed,
      turnsUsed: agentResult.turnsUsed,
      toolCalls: agentResult.toolCalls,
      attempts: agentResult.attempts,
    },
    lastAgentSummary,
  };
}

type RecordRunFn = (outcome: {
  ok: boolean;
  stage: string;
  changed?: boolean | null;
  error?: string;
  modelUsed?: FixModel;
  modelsTried?: FixModel[];
  turnsUsed?: number | null;
  toolCalls?: number | null;
  attempts?: FixAttemptTiming[];
  variantIndex?: number;
  durationMs?: number;
}) => void;

function createFixRunRecorder(args: {
  count: number;
  fixStartedAt: number;
  found: FoundComment;
  id: string;
  model: FixModel;
  modelChain: FixModel[];
  projectRoot: string;
}): RecordRunFn {
  const { projectRoot, found, id, model, modelChain, fixStartedAt, count } =
    args;
  return (outcome) => {
    appendFixRunLog(projectRoot, {
      ts: new Date().toISOString(),
      comment: id,
      file: found.relativePath,
      anchor: found.comment.anchor,
      textLength: found.comment.text.length,
      screenshotIncluded:
        Boolean(found.comment.screenshot) &&
        shouldIncludeScreenshotInPrompt(found.comment.text),
      modelRequested: model,
      modelChain,
      durationMs: outcome.durationMs ?? Date.now() - fixStartedAt,
      variantIndex: outcome.variantIndex,
      variantCount: count,
      ...outcome,
    });
  };
}

interface VariantBatchState {
  createdVersions: number[];
  hadAgentFailure: boolean;
  lastAgentError?: string;
  lastModelUsed?: FixModel;
  lastPng?: string;
  lastSuccessfulSource?: string;
  lastToolCalls?: number;
  lastTurnsUsed?: number;
  terminalReached?: boolean;
}

type VariantStepResult =
  | { action: "continue" }
  | { action: "abort"; error: string }
  | { action: "success"; nextV: number; png: string; afterSource: string };

async function persistChangedVariant(args: {
  count: number;
  found: FoundComment;
  id: string;
  iterDir: string;
  iterationRoots: string[];
  lastAgentSummary: string | undefined;
  recordRun: RecordRunFn;
  result: VariantRunOutcome;
  stream: NdjsonStream;
  variantIndex: number;
  variantStartedAt: number;
}): Promise<VariantStepResult> {
  const {
    count,
    found,
    id,
    iterDir,
    iterationRoots,
    lastAgentSummary,
    recordRun,
    result,
    stream,
    variantIndex,
    variantStartedAt,
  } = args;

  const versionResult = await nextIterationVersion(iterDir);
  if (!versionResult.ok) {
    recordRun({
      ok: false,
      stage: "version",
      error: versionResult.error,
      modelUsed: result.modelUsed,
      changed: true,
      turnsUsed: result.turnsUsed,
      toolCalls: result.toolCalls,
      attempts: result.attempts,
      variantIndex,
      durationMs: Date.now() - variantStartedAt,
    });
    return count === 1
      ? { action: "abort", error: versionResult.error }
      : { action: "continue" };
  }

  const nextV = versionResult.nextV;
  const variantPrefix = variantProgressPrefix(variantIndex, count);
  const persisted = await persistNewIterationSnapshot(
    found,
    id,
    iterDir,
    nextV,
    result.afterSource as string,
    iterationRoots,
    lastAgentSummary,
    stream,
    { setActive: false, variantPrefix }
  );

  if (!persisted.ok) {
    recordRun({
      ok: false,
      stage: "persist",
      error: persisted.error,
      modelUsed: result.modelUsed,
      changed: true,
      turnsUsed: result.turnsUsed,
      toolCalls: result.toolCalls,
      attempts: result.attempts,
      variantIndex,
      durationMs: Date.now() - variantStartedAt,
    });
    return count === 1
      ? { action: "abort", error: persisted.error }
      : { action: "continue" };
  }

  recordRun({
    ok: true,
    stage: "done",
    changed: true,
    modelUsed: result.modelUsed,
    turnsUsed: result.turnsUsed,
    toolCalls: result.toolCalls,
    attempts: result.attempts,
    variantIndex,
    durationMs: Date.now() - variantStartedAt,
  });

  return {
    action: "success",
    nextV,
    png: persisted.png,
    afterSource: result.afterSource as string,
  };
}

async function runVariantBatch(args: {
  beforeSource: string;
  count: number;
  found: FoundComment;
  id: string;
  iterDir: string;
  iterationRoots: string[];
  model: FixModel;
  projectRoot: string;
  recordRun: RecordRunFn;
  stream: NdjsonStream;
}): Promise<VariantBatchState> {
  const state: VariantBatchState = {
    createdVersions: [],
    hadAgentFailure: false,
  };
  const priorVariantApproaches: string[] = [];

  for (let variantIndex = 1; variantIndex <= args.count; variantIndex += 1) {
    if (args.stream.clientGone()) {
      break;
    }

    const variantStartedAt = Date.now();
    const { result, lastAgentSummary } = await runSingleFixVariant({
      beforeSource: args.beforeSource,
      count: args.count,
      found: args.found,
      model: args.model,
      priorVariantApproaches,
      projectRoot: args.projectRoot,
      stream: args.stream,
      variantIndex,
    });

    if (args.stream.clientGone()) {
      break;
    }

    if (!result.ok) {
      state.hadAgentFailure = true;
      state.lastAgentError = result.error;
      args.recordRun({
        ok: false,
        stage: result.stage,
        error: result.error,
        attempts: result.attempts,
        variantIndex,
        durationMs: Date.now() - variantStartedAt,
      });
      if (args.count === 1) {
        args.stream.endStream({ type: "done", ok: false, error: result.error });
        state.terminalReached = true;
        return state;
      }
      continue;
    }

    if (!result.changed) {
      args.recordRun({
        ok: true,
        stage: "done",
        changed: false,
        modelUsed: result.modelUsed,
        turnsUsed: result.turnsUsed,
        toolCalls: result.toolCalls,
        attempts: result.attempts,
        variantIndex,
        durationMs: Date.now() - variantStartedAt,
      });
      continue;
    }

    const step = await persistChangedVariant({
      count: args.count,
      found: args.found,
      id: args.id,
      iterDir: args.iterDir,
      iterationRoots: args.iterationRoots,
      lastAgentSummary,
      recordRun: args.recordRun,
      result,
      stream: args.stream,
      variantIndex,
      variantStartedAt,
    });

    if (step.action === "abort") {
      args.stream.endStream({ type: "done", ok: false, error: step.error });
      state.terminalReached = true;
      return state;
    }
    if (step.action === "continue") {
      continue;
    }

    state.createdVersions.push(step.nextV);
    state.lastSuccessfulSource = step.afterSource;
    state.lastModelUsed = result.modelUsed;
    state.lastTurnsUsed = result.turnsUsed;
    state.lastToolCalls = result.toolCalls;
    state.lastPng = step.png;

    const approachSummary =
      lastAgentSummary?.trim() ||
      summarizeFixSourceDiff(args.beforeSource, step.afterSource);
    priorVariantApproaches.push(`Variant ${variantIndex}: ${approachSummary}`);
  }

  return state;
}

function finishNoVariants(args: {
  count: number;
  fixStartedAt: number;
  id: string;
  recordRun: RecordRunFn;
  state: VariantBatchState;
  stream: NdjsonStream;
}): void {
  const lastAgentError =
    args.count > 1 && args.state.hadAgentFailure && !args.state.lastAgentError
      ? "All variants failed or made no changes"
      : args.state.lastAgentError;

  args.recordRun({
    ok: true,
    stage: "done",
    changed: false,
    modelUsed: args.state.lastModelUsed,
    durationMs: Date.now() - args.fixStartedAt,
  });
  args.stream.endStream({
    type: "done",
    ok: true,
    id: args.id,
    changed: false,
    modelUsed: args.state.lastModelUsed,
    durationMs: Date.now() - args.fixStartedAt,
    ...(args.count > 1 && args.state.hadAgentFailure && lastAgentError
      ? { error: lastAgentError }
      : {}),
  });
}

async function finishSuccessfulBatch(args: {
  fixStartedAt: number;
  found: FoundComment;
  id: string;
  recordRun: RecordRunFn;
  state: VariantBatchState;
  stream: NdjsonStream;
}): Promise<void> {
  const lastV = args.state.createdVersions.at(-1) as number;

  try {
    await atomicWriteText(
      args.found.absolutePath,
      args.state.lastSuccessfulSource as string
    );
  } catch (err) {
    args.recordRun({
      ok: false,
      stage: "apply",
      error: errorMessage(err),
      modelUsed: args.state.lastModelUsed,
      changed: true,
      durationMs: Date.now() - args.fixStartedAt,
    });
    args.stream.endStream({
      type: "done",
      ok: false,
      error: errorMessage(err),
    });
    return;
  }

  try {
    await updateCommentActive({
      absolutePath: args.found.absolutePath,
      commentId: args.id,
      active: lastV,
    });
  } catch (err) {
    const message = activeUpdateErrorMessage(err);
    args.recordRun({
      ok: false,
      stage: "apply",
      error: message,
      modelUsed: args.state.lastModelUsed,
      changed: true,
      durationMs: Date.now() - args.fixStartedAt,
    });
    args.stream.endStream({ type: "done", ok: false, error: message });
    return;
  }

  if (args.stream.clientGone()) {
    return;
  }

  const durationMs = Date.now() - args.fixStartedAt;
  args.stream.endStream({
    type: "done",
    ok: true,
    id: args.id,
    changed: true,
    v: lastV,
    versions: args.state.createdVersions,
    tsx: `/designs/iterations/${args.id}/v${lastV}.tsx`,
    png: args.state.lastPng,
    modelUsed: args.state.lastModelUsed,
    durationMs,
    turnsUsed: args.state.lastTurnsUsed,
    toolCalls: args.state.lastToolCalls,
  });
}

export async function runNewIteration(
  input: RunNewIterationInput
): Promise<void> {
  const { projectRoot, found, id, model, count, stream } = input;

  const fixStartedAt = Date.now();
  const priority =
    getFixRuntimeConfig().fixModelPriority ?? DEFAULT_FIX_MODEL_PRIORITY;
  const modelChain = buildFixModelChain(model, priority);
  const recordRun = createFixRunRecorder({
    projectRoot,
    found,
    id,
    model,
    modelChain,
    fixStartedAt,
    count,
  });

  let beforeSource: string;
  try {
    beforeSource = await readFile(found.absolutePath, "utf8");
  } catch (err) {
    recordRun({ ok: false, stage: "before-read", error: errorMessage(err) });
    stream.endStream({
      type: "done",
      ok: false,
      error: errorMessage(err),
    });
    return;
  }

  console.info(
    `[vite-plugin-comments] dispatching fix model=${model} chain=[${modelChain.join(", ")}] count=${count} comment=${id} file=${found.relativePath}`
  );

  const iterDir = path.join(projectRoot, "designs", "iterations", id);
  const iterationRoots = resolveIterationDirRoots(projectRoot, id);
  const state = await runVariantBatch({
    beforeSource,
    count,
    found,
    id,
    iterDir,
    iterationRoots,
    model,
    projectRoot,
    recordRun,
    stream,
  });

  if (state.terminalReached) {
    return;
  }

  if (stream.clientGone() || state.createdVersions.length === 0) {
    if (state.createdVersions.length === 0 && !stream.clientGone()) {
      finishNoVariants({ count, fixStartedAt, id, recordRun, state, stream });
    }
    return;
  }

  await finishSuccessfulBatch({
    fixStartedAt,
    found,
    id,
    recordRun,
    state,
    stream,
  });
}
