import { copyFile, readFile, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { getAgentRuntimeConfig } from "../agent/config.ts";
import { runAgent } from "../agent/index.ts";
import {
  type AgentModel,
  buildAgentModelChain,
  DEFAULT_AGENT_MODEL_PRIORITY,
} from "../agent/models.ts";
import {
  shouldIncludeScreenshotInPrompt,
  summarizeAgentSourceDiff,
} from "../agent/prompt.ts";
import { appendAgentRunLog } from "../agent/run-log.ts";
import type { AgentSkill } from "../agent/skills.ts";
import type { AgentAttemptTiming } from "../agent/types.ts";
import type { FoundComment } from "../comments/find-comment.ts";
import { updateCommentActive } from "../comments/writer.ts";
import { setCommentActiveInSource } from "../comments/writer-directive.ts";
import { WriteError } from "../comments/writer-errors.ts";
import { atomicWriteText } from "../platform/atomic-write.ts";
import { errorMessage } from "../platform/http.ts";
import { resolveSafeProjectRelativePath } from "../platform/path-safety.ts";
import {
  type AuxFileMap,
  mergeBaselineAuxFiles,
  restoreAuxFilesForVersion,
  writeVersionAuxFiles,
} from "./aux-files.ts";
import {
  findVersionPngPath,
  iterationPngUrl,
  nextIterationVersion,
  patchIterationsManifest,
  pngMtimeMs,
  resolveIterationDirRoots,
} from "./manifest.ts";
import {
  diffSourceSnapshots,
  snapshotSourceFiles,
  toRelPosix,
} from "./source-files.ts";

export interface NdjsonStream {
  abortController: AbortController;
  clientGone: () => boolean;
  endStream: (final: object) => void;
  writeEvent: (event: object) => void;
}

export function createNdjsonStream(
  req: IncomingMessage,
  res: ServerResponse,
  options: {
    abortController?: AbortController;
    abortOnClose?: boolean;
  } = {}
): NdjsonStream {
  const abortController = options.abortController ?? new AbortController();
  const abortOnClose = options.abortOnClose ?? true;
  let disconnected = false;
  const onClose = () => {
    if (disconnected) {
      return;
    }
    disconnected = true;
    if (abortOnClose) {
      abortController.abort();
    }
  };
  req.on("close", onClose);

  const writeEvent = (event: object): void => {
    if (disconnected || res.destroyed) {
      return;
    }
    try {
      res.write(`${JSON.stringify(event)}\n`);
    } catch {
      disconnected = true;
      if (abortOnClose) {
        abortController.abort();
      }
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
    clientGone: () => abortController.signal.aborted,
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

/**
 * Reset files an earlier variant in this batch touched back to their pre-agent
 * content, so each variant starts from a clean baseline. A `null`/missing
 * baseline means the file did not exist before, so we remove it.
 */
async function restoreFilesToBaseline(
  projectRoot: string,
  rels: Iterable<string>,
  baselineFiles: Map<string, string>
): Promise<void> {
  for (const rel of rels) {
    const resolved = resolveSafeProjectRelativePath(projectRoot, rel);
    if (!resolved.ok) {
      continue;
    }
    const abs = resolved.absolutePath;
    const baseline = baselineFiles.get(rel);
    if (baseline === undefined) {
      try {
        await unlink(abs);
      } catch {
        // already gone — fine
      }
      continue;
    }
    try {
      await atomicWriteText(abs, baseline);
    } catch {
      // best-effort restore; the agent re-reads files before editing
    }
  }
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
  options: {
    auxBaseline: AuxFileMap;
    auxFiles: AuxFileMap;
    createdAt: string;
    runId: string;
    setActive: boolean;
    variantPrefix: string;
  }
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

  // Persist edits to files OTHER than the comment's file (e.g. a reused
  // component's own definition) plus their pre-agent baseline, so switching
  // versions can restore or revert them.
  try {
    await writeVersionAuxFiles(iterDir, nextV, options.auxFiles);
    if (Object.keys(options.auxBaseline).length > 0) {
      await mergeBaselineAuxFiles(iterDir, options.auxBaseline);
    }
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
    const summary = lastAgentSummary?.trim() || `Agent v${nextV}`;
    await patchIterationsManifest(iterDir, nextV, {
      summary,
      createdAt: options.createdAt,
      runId: options.runId,
      screenshotCaptured: false,
    });
    stream.writeEvent({
      type: "progress",
      stage: "snapshot",
      detail: `${options.variantPrefix}persisted v${nextV}`,
      version: nextV,
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
  hooks?: RunNewIterationHooks;
  id: string;
  model: AgentModel;
  projectRoot: string;
  skills: AgentSkill[];
  stream: NdjsonStream;
}

interface RunNewIterationSourceAppliedEvent {
  absolutePath: string;
  active: number;
  file: string;
  id: string;
}

export interface RunNewIterationVariantCaptureEvent
  extends RunNewIterationSourceAppliedEvent {
  version: number;
}

interface RunNewIterationHooks {
  onInternalSourceWorkFinish?: (
    event: RunNewIterationSourceAppliedEvent
  ) => Promise<void> | void;
  onInternalSourceWorkStart?: (
    event: RunNewIterationSourceAppliedEvent
  ) => Promise<void> | void;
  onSourceApplied?: (event: RunNewIterationSourceAppliedEvent) => void;
  onVariantScreenshotRequested?: (
    event: RunNewIterationVariantCaptureEvent
  ) => Promise<void> | void;
}

async function notifyInternalSourceWork(
  hook:
    | ((event: RunNewIterationSourceAppliedEvent) => Promise<void> | void)
    | undefined,
  event: RunNewIterationSourceAppliedEvent
): Promise<void> {
  try {
    await hook?.(event);
  } catch {
    // Internal source watcher suppression is best-effort.
  }
}

function notifyRunSourceApplied(
  hooks: RunNewIterationHooks | undefined,
  event: RunNewIterationSourceAppliedEvent
): void {
  try {
    hooks?.onSourceApplied?.(event);
  } catch {
    // HMR notification is best-effort; the source rewrite already succeeded.
  }
}

async function waitForVariantScreenshot(
  hooks: RunNewIterationHooks | undefined,
  event: RunNewIterationVariantCaptureEvent
): Promise<void> {
  try {
    await hooks?.onVariantScreenshotRequested?.(event);
  } catch {
    // Screenshot capture is best-effort; keep generating remaining variants.
  }
}

interface VariantRunOutcome {
  afterSource?: string;
  attempts?: AgentAttemptTiming[];
  /** Files OTHER than the comment file the agent changed in this variant. */
  auxBaseline?: AuxFileMap;
  auxFiles?: AuxFileMap;
  changed: boolean;
  error?: string;
  modelUsed?: AgentModel;
  ok: boolean;
  stage: string;
  toolCalls?: number;
  turnsUsed?: number;
}

async function runSingleAgentVariant(args: {
  baselineFiles: Map<string, string>;
  beforeSource: string;
  commentRel: string;
  count: number;
  found: FoundComment;
  model: AgentModel;
  priorVariantApproaches: string[];
  projectRoot: string;
  skills: AgentSkill[];
  stream: NdjsonStream;
  touchedAux: Set<string>;
  variantIndex: number;
}): Promise<{ result: VariantRunOutcome; lastAgentSummary?: string }> {
  const {
    baselineFiles,
    beforeSource,
    commentRel,
    count,
    found,
    model,
    priorVariantApproaches,
    projectRoot,
    skills,
    stream,
    touchedAux,
    variantIndex,
  } = args;
  const variantPrefix = variantProgressPrefix(variantIndex, count);

  try {
    await atomicWriteText(found.absolutePath, beforeSource);
    // Undo any cross-file edits from earlier variants so this one starts clean.
    await restoreFilesToBaseline(projectRoot, touchedAux, baselineFiles);
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
  const agentResult = await runAgent({
    projectRoot,
    file: found.relativePath,
    anchor: found.comment.anchor,
    text: found.comment.text,
    screenshot: found.comment.screenshot,
    view: found.comment.view,
    activeVersion: found.comment.active ?? 0,
    replies: found.comment.replies,
    model,
    skills,
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

  // Detect edits to files OTHER than the comment file (e.g. a reused
  // component's definition) by diffing the source tree against the batch
  // baseline. The comment file is snapshotted separately as v{N}.tsx.
  const afterFiles = await snapshotSourceFiles(projectRoot);
  const changedFiles = diffSourceSnapshots(baselineFiles, afterFiles);
  changedFiles.delete(commentRel);
  const auxFiles: AuxFileMap = {};
  const auxBaseline: AuxFileMap = {};
  for (const [rel, content] of changedFiles) {
    auxFiles[rel] = content;
    auxBaseline[rel] = baselineFiles.get(rel) ?? null;
  }
  const auxChanged = Object.keys(auxFiles).length > 0;

  if (afterSource === beforeSource && !auxChanged) {
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
      auxFiles,
      auxBaseline,
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
  modelUsed?: AgentModel;
  modelsTried?: AgentModel[];
  turnsUsed?: number | null;
  toolCalls?: number | null;
  attempts?: AgentAttemptTiming[];
  variantIndex?: number;
  durationMs?: number;
}) => void;

function createAgentRunRecorder(args: {
  count: number;
  agentStartedAt: number;
  found: FoundComment;
  id: string;
  model: AgentModel;
  modelChain: AgentModel[];
  projectRoot: string;
}): RecordRunFn {
  const { projectRoot, found, id, model, modelChain, agentStartedAt, count } =
    args;
  return (outcome) => {
    appendAgentRunLog(projectRoot, {
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
      durationMs: outcome.durationMs ?? Date.now() - agentStartedAt,
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
  lastModelUsed?: AgentModel;
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
  hooks?: RunNewIterationHooks;
  id: string;
  iterDir: string;
  iterationRoots: string[];
  lastAgentSummary: string | undefined;
  recordRun: RecordRunFn;
  runCreatedAt: string;
  runId: string;
  result: VariantRunOutcome;
  stream: NdjsonStream;
  variantIndex: number;
  variantStartedAt: number;
}): Promise<VariantStepResult> {
  const {
    count,
    found,
    hooks,
    id,
    iterDir,
    iterationRoots,
    lastAgentSummary,
    recordRun,
    runCreatedAt,
    runId,
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
    {
      auxBaseline: result.auxBaseline ?? {},
      auxFiles: result.auxFiles ?? {},
      createdAt: runCreatedAt,
      runId,
      setActive: false,
      variantPrefix,
    }
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

  const captureEvent = {
    absolutePath: found.absolutePath,
    active: nextV,
    file: found.relativePath,
    id,
    version: nextV,
  };
  notifyRunSourceApplied(hooks, captureEvent);
  const screenshotUploaded = waitForVariantScreenshot(hooks, captureEvent);
  stream.writeEvent({
    type: "progress",
    stage: "snapshot",
    detail: `${variantPrefix}capturing v${nextV}.png`,
    version: nextV,
    capture: true,
  });
  await screenshotUploaded;

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

/** Accumulate the relative paths a variant touched into the batch's set. */
function addAuxPaths(touchedAux: Set<string>, auxFiles?: AuxFileMap): void {
  for (const rel of Object.keys(auxFiles ?? {})) {
    touchedAux.add(rel);
  }
}

async function runVariantBatch(args: {
  beforeSource: string;
  count: number;
  found: FoundComment;
  hooks?: RunNewIterationHooks;
  id: string;
  iterDir: string;
  iterationRoots: string[];
  model: AgentModel;
  projectRoot: string;
  recordRun: RecordRunFn;
  runCreatedAt: string;
  runId: string;
  skills: AgentSkill[];
  stream: NdjsonStream;
}): Promise<VariantBatchState> {
  const state: VariantBatchState = {
    createdVersions: [],
    hadAgentFailure: false,
  };
  const priorVariantApproaches: string[] = [];

  // Pre-agent snapshot of the whole source tree. Diffing against it after each
  // variant reveals cross-file edits (e.g. to a reused component's definition);
  // `touchedAux` accumulates them so later variants reset to baseline first.
  const baselineFiles = await snapshotSourceFiles(args.projectRoot);
  const commentRel = toRelPosix(args.projectRoot, args.found.absolutePath);
  const touchedAux = new Set<string>();

  for (let variantIndex = 1; variantIndex <= args.count; variantIndex += 1) {
    if (args.stream.clientGone()) {
      break;
    }

    const variantStartedAt = Date.now();
    const internalSourceEvent = {
      absolutePath: args.found.absolutePath,
      active: 0,
      file: args.found.relativePath,
      id: args.id,
    };
    await notifyInternalSourceWork(
      args.hooks?.onInternalSourceWorkStart,
      internalSourceEvent
    );
    let variantOutput: Awaited<ReturnType<typeof runSingleAgentVariant>>;
    try {
      variantOutput = await runSingleAgentVariant({
        baselineFiles,
        beforeSource: args.beforeSource,
        commentRel,
        count: args.count,
        found: args.found,
        model: args.model,
        priorVariantApproaches,
        projectRoot: args.projectRoot,
        skills: args.skills,
        stream: args.stream,
        touchedAux,
        variantIndex,
      });
    } finally {
      await notifyInternalSourceWork(
        args.hooks?.onInternalSourceWorkFinish,
        internalSourceEvent
      );
    }
    const { result, lastAgentSummary } = variantOutput;

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
      hooks: args.hooks,
      id: args.id,
      iterDir: args.iterDir,
      iterationRoots: args.iterationRoots,
      lastAgentSummary,
      recordRun: args.recordRun,
      runCreatedAt: args.runCreatedAt,
      runId: args.runId,
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
    addAuxPaths(touchedAux, result.auxFiles);

    const approachSummary =
      lastAgentSummary?.trim() ||
      summarizeAgentSourceDiff(args.beforeSource, step.afterSource);
    priorVariantApproaches.push(`Variant ${variantIndex}: ${approachSummary}`);
  }

  return state;
}

function finishNoVariants(args: {
  count: number;
  agentStartedAt: number;
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
    durationMs: Date.now() - args.agentStartedAt,
  });
  args.stream.endStream({
    type: "done",
    ok: true,
    id: args.id,
    changed: false,
    modelUsed: args.state.lastModelUsed,
    durationMs: Date.now() - args.agentStartedAt,
    ...(args.count > 1 && args.state.hadAgentFailure && lastAgentError
      ? { error: lastAgentError }
      : {}),
  });
}

async function finishSuccessfulBatch(args: {
  agentStartedAt: number;
  found: FoundComment;
  hooks?: RunNewIterationHooks;
  id: string;
  iterationRoots: string[];
  projectRoot: string;
  recordRun: RecordRunFn;
  state: VariantBatchState;
  stream: NdjsonStream;
}): Promise<void> {
  const lastV = args.state.createdVersions.at(-1) as number;

  let sourceWithActive: string;
  try {
    sourceWithActive = setCommentActiveInSource(
      args.state.lastSuccessfulSource as string,
      args.id,
      lastV
    );
  } catch (err) {
    args.recordRun({
      ok: false,
      stage: "apply",
      error: errorMessage(err),
      modelUsed: args.state.lastModelUsed,
      changed: true,
      durationMs: Date.now() - args.agentStartedAt,
    });
    args.stream.endStream({
      type: "done",
      ok: false,
      error: errorMessage(err),
    });
    return;
  }

  try {
    await atomicWriteText(args.found.absolutePath, sourceWithActive);
  } catch (err) {
    args.recordRun({
      ok: false,
      stage: "apply",
      error: errorMessage(err),
      modelUsed: args.state.lastModelUsed,
      changed: true,
      durationMs: Date.now() - args.agentStartedAt,
    });
    args.stream.endStream({
      type: "done",
      ok: false,
      error: errorMessage(err),
    });
    return;
  }

  notifyRunSourceApplied(args.hooks, {
    absolutePath: args.found.absolutePath,
    active: lastV,
    file: args.found.relativePath,
    id: args.id,
  });

  // Make sure every cross-file edit on disk matches the now-active version
  // (the final variant may have touched a different file set than earlier ones)
  // and trigger HMR for each.
  try {
    const auxWritten = await restoreAuxFilesForVersion(
      args.projectRoot,
      args.iterationRoots,
      lastV
    );
    for (const absolutePath of auxWritten) {
      notifyRunSourceApplied(args.hooks, {
        absolutePath,
        active: lastV,
        file: args.found.relativePath,
        id: args.id,
      });
    }
  } catch {
    // The agent's own edits already left the files in the right state.
  }

  if (args.stream.clientGone()) {
    return;
  }

  const durationMs = Date.now() - args.agentStartedAt;
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
  const { projectRoot, found, hooks, id, model, count, skills, stream } = input;

  const agentStartedAt = Date.now();
  const runCreatedAt = new Date(agentStartedAt).toISOString();
  const runId = `${id}:${agentStartedAt}`;
  const priority =
    getAgentRuntimeConfig().agentModelPriority ?? DEFAULT_AGENT_MODEL_PRIORITY;
  const modelChain = buildAgentModelChain(model, priority);
  const recordRun = createAgentRunRecorder({
    projectRoot,
    found,
    id,
    model,
    modelChain,
    agentStartedAt,
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
    `[vite-plugin-comments] dispatching agent model=${model} chain=[${modelChain.join(", ")}] count=${count} comment=${id} file=${found.relativePath}`
  );

  const iterDir = path.join(projectRoot, "designs", "iterations", id);
  const iterationRoots = resolveIterationDirRoots(projectRoot, id);
  const state = await runVariantBatch({
    beforeSource,
    count,
    found,
    hooks,
    id,
    iterDir,
    iterationRoots,
    model,
    projectRoot,
    recordRun,
    runCreatedAt,
    runId,
    skills,
    stream,
  });

  if (state.terminalReached) {
    return;
  }

  if (stream.clientGone() || state.createdVersions.length === 0) {
    if (state.createdVersions.length === 0 && !stream.clientGone()) {
      finishNoVariants({ count, agentStartedAt, id, recordRun, state, stream });
    }
    return;
  }

  await finishSuccessfulBatch({
    agentStartedAt,
    found,
    hooks,
    id,
    iterationRoots,
    projectRoot,
    recordRun,
    state,
    stream,
  });
}
