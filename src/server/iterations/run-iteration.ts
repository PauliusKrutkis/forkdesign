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
import { WriteError } from "../comments/writer-errors.ts";
import { atomicWriteText } from "../platform/atomic-write.ts";
import { errorMessage } from "../platform/http.ts";
import { resolveSafeProjectRelativePath } from "../platform/path-safety.ts";
import { applyIterationVersionToSource } from "./activate-version.ts";
import {
  createAgentWorkspace,
  mapFoundCommentToWorkspace,
} from "./agent-workspace.ts";
import {
  type AuxFileMap,
  mergeBaselineAuxFiles,
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
  activeIterationRunVisibleActive,
  withIterationSourceLock,
} from "./runs.ts";
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

interface VariantRunOutcome {
  afterSource?: string;
  attempts?: AgentAttemptTiming[];
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
  commentId: string;
  commentRel: string;
  count: number;
  found: FoundComment;
  model: AgentModel;
  priorVariantApproaches: string[];
  skills: AgentSkill[];
  stream: NdjsonStream;
  touchedAux: Set<string>;
  variantIndex: number;
  workspaceRoot: string;
}): Promise<{ result: VariantRunOutcome; lastAgentSummary?: string }> {
  const {
    baselineFiles,
    beforeSource,
    commentId,
    commentRel,
    count,
    found,
    model,
    priorVariantApproaches,
    skills,
    stream,
    touchedAux,
    variantIndex,
    workspaceRoot,
  } = args;
  const variantPrefix = variantProgressPrefix(variantIndex, count);

  if (stream.clientGone()) {
    return {
      result: {
        ok: false,
        changed: false,
        stage: "cancelled",
        error: "iteration cancelled",
      },
    };
  }

  try {
    await atomicWriteText(found.absolutePath, beforeSource);
    // Undo cross-file edits from earlier variants in the workspace only.
    await restoreFilesToBaseline(workspaceRoot, touchedAux, baselineFiles);
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
    projectRoot: workspaceRoot,
    commentId,
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

  if (stream.clientGone()) {
    return {
      result: {
        ok: false,
        changed: false,
        stage: "cancelled",
        error: "iteration cancelled",
        modelUsed: agentResult.ok ? agentResult.modelUsed : undefined,
        attempts: agentResult.attempts,
      },
      lastAgentSummary,
    };
  }

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
  const afterFiles = await snapshotSourceFiles(workspaceRoot);
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
  baselineFiles: Map<string, string>;
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

async function restoreSourceTreeToSnapshot(
  projectRoot: string,
  baselineFiles: Map<string, string>
): Promise<void> {
  const currentFiles = await snapshotSourceFiles(projectRoot);
  const changedFiles = diffSourceSnapshots(baselineFiles, currentFiles);
  await restoreFilesToBaseline(projectRoot, changedFiles.keys(), baselineFiles);
}

async function restoreSourceTreeIfCancelled(args: {
  baselineFiles: Map<string, string>;
  projectRoot: string;
  stream: NdjsonStream;
}): Promise<boolean> {
  if (!args.stream.clientGone()) {
    return false;
  }
  await restoreSourceTreeToSnapshot(args.projectRoot, args.baselineFiles);
  return true;
}

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

  if (stream.clientGone()) {
    return { action: "continue" };
  }

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
  if (stream.clientGone()) {
    return { action: "continue" };
  }
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

  stream.writeEvent({
    type: "progress",
    stage: "snapshot",
    detail: `${variantPrefix}persisted v${nextV}`,
    version: nextV,
  });

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

function addAuxPaths(touchedAux: Set<string>, auxFiles?: AuxFileMap): void {
  for (const rel of Object.keys(auxFiles ?? {})) {
    touchedAux.add(rel);
  }
}

async function runVariantBatch(args: {
  baselineFiles: Map<string, string>;
  beforeSource: string;
  count: number;
  found: FoundComment;
  hooks?: RunNewIterationHooks;
  id: string;
  iterDir: string;
  iterationRoots: string[];
  liveProjectRoot: string;
  model: AgentModel;
  recordRun: RecordRunFn;
  runCreatedAt: string;
  runId: string;
  skills: AgentSkill[];
  stream: NdjsonStream;
  workspaceRoot: string;
}): Promise<VariantBatchState> {
  const { baselineFiles, liveProjectRoot, workspaceRoot } = args;
  const state: VariantBatchState = {
    baselineFiles,
    createdVersions: [],
    hadAgentFailure: false,
  };
  const priorVariantApproaches: string[] = [];
  const workspaceFound = mapFoundCommentToWorkspace(
    args.found,
    liveProjectRoot,
    workspaceRoot
  );

  const commentRel = toRelPosix(liveProjectRoot, args.found.absolutePath);
  const touchedAux = new Set<string>();

  for (let variantIndex = 1; variantIndex <= args.count; variantIndex += 1) {
    if (
      await restoreSourceTreeIfCancelled({
        baselineFiles,
        projectRoot: liveProjectRoot,
        stream: args.stream,
      })
    ) {
      break;
    }

    const variantStartedAt = Date.now();
    const variantOutput = await runSingleAgentVariant({
      baselineFiles,
      beforeSource: args.beforeSource,
      commentId: args.id,
      commentRel,
      count: args.count,
      found: workspaceFound,
      model: args.model,
      priorVariantApproaches,
      skills: args.skills,
      stream: args.stream,
      touchedAux,
      variantIndex,
      workspaceRoot,
    });
    const { result, lastAgentSummary } = variantOutput;

    if (
      await restoreSourceTreeIfCancelled({
        baselineFiles,
        projectRoot: liveProjectRoot,
        stream: args.stream,
      })
    ) {
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
        args.stream.endStream({
          type: "done",
          ok: false,
          error: result.error,
        });
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
      await restoreSourceTreeIfCancelled({
        baselineFiles,
        projectRoot: liveProjectRoot,
        stream: args.stream,
      });
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
  projectRoot: string;
  recordRun: RecordRunFn;
  state: VariantBatchState;
  stream: NdjsonStream;
}): Promise<void> {
  const lastV = args.state.createdVersions.at(-1) as number;
  const winnerV = activeIterationRunVisibleActive(args.id) ?? lastV;
  // Re-resolve after snapshots may have created the primary agent tree.
  const iterationRoots = resolveIterationDirRoots(args.projectRoot, args.id);

  if (
    await restoreSourceTreeIfCancelled({
      baselineFiles: args.state.baselineFiles,
      projectRoot: args.projectRoot,
      stream: args.stream,
    })
  ) {
    return;
  }

  let applied: Awaited<ReturnType<typeof applyIterationVersionToSource>>;
  try {
    if (args.stream.clientGone()) {
      await restoreSourceTreeToSnapshot(
        args.projectRoot,
        args.state.baselineFiles
      );
      return;
    }
    applied = await withIterationSourceLock(args.id, () =>
      applyIterationVersionToSource(
        args.found,
        iterationRoots,
        args.id,
        winnerV,
        args.projectRoot
      )
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

  if (!applied.ok) {
    args.recordRun({
      ok: false,
      stage: "apply",
      error: applied.message,
      modelUsed: args.state.lastModelUsed,
      changed: true,
      durationMs: Date.now() - args.agentStartedAt,
    });
    args.stream.endStream({
      type: "done",
      ok: false,
      error: applied.message,
    });
    return;
  }

  for (const absolutePath of applied.writtenFiles) {
    notifyRunSourceApplied(args.hooks, {
      absolutePath,
      active: winnerV,
      file: args.found.relativePath,
      id: args.id,
    });
  }

  if (args.stream.clientGone()) {
    return;
  }

  const winnerPng = iterationPngUrl(
    args.id,
    winnerV,
    pngMtimeMs(iterationRoots, winnerV)
  );
  const durationMs = Date.now() - args.agentStartedAt;
  args.stream.endStream({
    type: "done",
    ok: true,
    id: args.id,
    changed: true,
    v: winnerV,
    versions: args.state.createdVersions,
    tsx: `/designs/iterations/${args.id}/v${winnerV}.tsx`,
    png: winnerV === lastV ? args.state.lastPng : winnerPng,
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
  const baselineFiles = await snapshotSourceFiles(projectRoot);
  const workspace = await createAgentWorkspace({
    projectRoot,
    runId,
    baselineFiles,
  });

  let state: VariantBatchState;
  try {
    state = await runVariantBatch({
      baselineFiles,
      beforeSource,
      count,
      found,
      hooks,
      id,
      iterDir,
      iterationRoots,
      liveProjectRoot: projectRoot,
      model,
      recordRun,
      runCreatedAt,
      runId,
      skills,
      stream,
      workspaceRoot: workspace.workspaceRoot,
    });
  } finally {
    await workspace.cleanup();
  }

  if (state.terminalReached) {
    return;
  }

  if (stream.clientGone() || state.createdVersions.length === 0) {
    if (stream.clientGone()) {
      await restoreSourceTreeToSnapshot(projectRoot, state.baselineFiles);
    }
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
    projectRoot,
    recordRun,
    state,
    stream,
  });
}
