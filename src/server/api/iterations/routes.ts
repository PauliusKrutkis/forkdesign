import { mkdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { getAgentRuntimeConfig } from "../../agent/config.ts";
import {
  type AgentModel,
  DEFAULT_AGENT_MODEL_PRIORITY,
} from "../../agent/models.ts";
import { DEFAULT_AGENT_SKILLS } from "../../agent/skills.ts";
import { findCommentById } from "../../comments/find-comment.ts";
import { applyIterationVersionToSource } from "../../iterations/activate-version.ts";
import { deleteVersionAuxFiles } from "../../iterations/aux-files.ts";
import { resolveCommentIterationContext } from "../../iterations/context.ts";
import {
  deleteVersionArtifactsAllRoots,
  enrichVersionMeta,
  iterationPngUrl,
  listCompleteIterationVersionsAllRoots,
  pngMtimeMs,
  readIterationsManifest,
  resolveIterationDirRoots,
  tsxMtimeMs,
  updateVersionScreenshotCaptured,
  versionEntryFromManifest,
} from "../../iterations/manifest.ts";
import {
  createNdjsonStream,
  openNdjsonResponse,
  type RunNewIterationVariantCaptureEvent,
  runNewIteration,
} from "../../iterations/run-iteration.ts";
import {
  activeIterationRunVisibleActive,
  cancelIterationRun,
  finishIterationRun,
  hasActiveIterationRun,
  listActiveIterationRuns,
  startIterationRun,
  updateIterationRunStatus,
  updateIterationRunVisibleActive,
  withIterationSourceLock,
} from "../../iterations/runs.ts";
import { atomicWriteBytes } from "../../platform/atomic-write.ts";
import {
  errorMessage,
  readAndParse,
  readJsonBody,
  sendError,
  sendJson,
} from "../../platform/http.ts";
import { decodeScreenshotPng } from "../../platform/media.ts";
import { isSafePathSegment } from "../../platform/path-safety.ts";
import {
  parseActivateBody,
  parseDeleteVersionBody,
  parseNewIterationBody,
  parseScreenshotBody,
} from "./parse-body.ts";

export interface IterationSourceAppliedEvent {
  absolutePath: string;
  active: number;
  file: string;
  id: string;
}

export interface IterationRouteHooks {
  onInternalSourceWorkFinish?: (
    event: IterationSourceAppliedEvent
  ) => Promise<void> | void;
  onInternalSourceWorkStart?: (
    event: IterationSourceAppliedEvent
  ) => Promise<void> | void;
  onSourceApplied?: (event: IterationSourceAppliedEvent) => void;
}

interface IterationProgressEvent {
  detail?: string;
  tool?: string;
  type?: string;
}

const VARIANT_SCREENSHOT_TIMEOUT_MS = 10_000;
const screenshotWaiters = new Map<string, Set<() => void>>();

function screenshotWaiterKey(id: string, v: number): string {
  return `${id}:${v}`;
}

function waitForVariantScreenshotUpload(
  event: RunNewIterationVariantCaptureEvent
): Promise<void> {
  return new Promise((resolve) => {
    const key = screenshotWaiterKey(event.id, event.version);
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const done = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      const waiters = screenshotWaiters.get(key);
      waiters?.delete(done);
      if (waiters?.size === 0) {
        screenshotWaiters.delete(key);
      }
      resolve();
    };

    const waiters = screenshotWaiters.get(key) ?? new Set<() => void>();
    waiters.add(done);
    screenshotWaiters.set(key, waiters);
    timeout = setTimeout(done, VARIANT_SCREENSHOT_TIMEOUT_MS);
  });
}

function notifyVariantScreenshotUploaded(id: string, v: number): void {
  const waiters = screenshotWaiters.get(screenshotWaiterKey(id, v));
  if (!waiters) {
    return;
  }
  for (const done of [...waiters]) {
    done();
  }
}

function notifySourceApplied(
  hooks: IterationRouteHooks,
  event: IterationSourceAppliedEvent
): void {
  try {
    hooks.onSourceApplied?.(event);
  } catch {
    // HMR notification is best-effort; the source rewrite already succeeded.
  }
}

/**
 * GET /api/iterations?id=<comment-id>
 *
 * Reads the iterations directory on disk and returns the list of versions
 * where BOTH the v{N}.tsx snapshot and v{N}.png screenshot exist. Sorted
 * ascending by N. `active` is read off the @comment marker (defaults to 0
 * when the attribute is absent).
 */
export async function handleIterationsList(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[]
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const id = url.searchParams.get("id");
  if (!id) {
    sendError(res, 400, "missing query param: id");
    return;
  }
  if (!isSafePathSegment(id)) {
    sendError(res, 400, "query param `id` contains unsafe path characters");
    return;
  }

  const ctx = await resolveCommentIterationContext(
    projectRoot,
    id,
    excludeSrcPrefixes
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.message);
    return;
  }

  const { found, iterationRoots, iterDir } = ctx;
  const manifest = await readIterationsManifest(iterDir);

  const versionIndices =
    await listCompleteIterationVersionsAllRoots(iterationRoots);

  const versions = versionIndices.map((n) => {
    const meta = enrichVersionMeta(
      n,
      versionEntryFromManifest(manifest, n),
      tsxMtimeMs(iterDir, n)
    );
    return {
      v: n,
      tsx: `/designs/iterations/${id}/v${n}.tsx`,
      png: iterationPngUrl(id, n, pngMtimeMs(iterationRoots, n)),
      summary: meta.summary,
      createdAt: meta.createdAt,
      ...(meta.screenshotCaptured === false ? { screenshotPending: true } : {}),
      ...(meta.runId ? { runId: meta.runId } : {}),
    };
  });

  const active =
    activeIterationRunVisibleActive(id) ?? found.comment.active ?? 0;

  sendJson(res, {
    id,
    file: found.relativePath,
    active,
    versions,
  });
}

/** Normalized path after `/api/iterations` (handles mount-stripped and full URLs). */
export function iterationsSubpath(reqUrl: string): string {
  const url = new URL(reqUrl, "http://localhost");
  let sub = url.pathname;
  if (sub.startsWith("/api/iterations")) {
    sub = sub.slice("/api/iterations".length) || "/";
  }
  if (!sub.startsWith("/")) {
    sub = `/${sub}`;
  }
  if (sub.length > 1 && sub.endsWith("/")) {
    sub = sub.slice(0, -1);
  }
  return sub;
}

export function handleIterationsRuns(
  _req: IncomingMessage,
  res: ServerResponse
): void {
  sendJson(res, { runs: listActiveIterationRuns() });
}

export async function handleIterationsCancel(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body.ok) {
    sendError(res, 400, body.reason);
    return;
  }
  const id = (body.value as { id?: unknown }).id;
  if (typeof id !== "string" || !id.trim()) {
    sendError(res, 400, "missing field: id");
    return;
  }
  if (!isSafePathSegment(id)) {
    sendError(res, 400, "field `id` contains unsafe path characters");
    return;
  }
  const cancelled = cancelIterationRun(id);
  sendJson(res, { ok: true, cancelled });
}

/**
 * POST /api/iterations/activate { id, v }
 *
 * Replace the source file at `found.relativePath` with the saved snapshot at
 * `designs/iterations/<id>/v{N}.tsx`, then update the marker's `active=N` so
 * the next GET reflects the new selection.
 *
 * See the file-level CAVEAT above re: clobbering co-located edits.
 */
export async function handleIterationsActivate(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
  hooks: IterationRouteHooks = {}
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body.ok) {
    sendError(res, 400, body.reason);
    return;
  }
  const parsed = parseActivateBody(body.value);
  if (!parsed.ok) {
    sendError(res, 400, parsed.reason);
    return;
  }
  const { forCapture, id, v } = parsed.value;

  const ctx = await resolveCommentIterationContext(
    projectRoot,
    id,
    excludeSrcPrefixes
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.message);
    return;
  }

  // While a run is active the agent owns the live source tree. Rather than
  // reject the switch (the old 409), serialize it behind the per-comment source
  // lock so it applies at the next gap between variants without colliding with
  // the variant the agent is editing.
  const applied = await withIterationSourceLock(id, () =>
    applyIterationVersionToSource(
      ctx.found,
      ctx.iterationRoots,
      id,
      v,
      projectRoot
    )
  );
  if (!applied.ok) {
    sendError(res, applied.status, applied.message);
    return;
  }

  // Keep the in-flight run's visible-active in sync so a concurrent GET reflects
  // the user's choice instead of the version last captured by the agent.
  if (hasActiveIterationRun(id) && !forCapture) {
    updateIterationRunVisibleActive(id, v);
  }

  // Trigger HMR for every file the activation touched — the comment's file AND
  // any cross-file (reused-component) edits the version restored.
  for (const absolutePath of applied.writtenFiles) {
    notifySourceApplied(hooks, {
      absolutePath,
      active: v,
      file: ctx.found.relativePath,
      id,
    });
  }

  sendJson(res, {
    ok: true,
    id,
    file: ctx.found.relativePath,
    active: v,
  });
}

/**
 * POST /api/iterations/delete { id, v }
 *
 * Removes v{N}.tsx, v{N}.png, and the manifest entry. Baseline (v0) cannot be
 * deleted. If the deleted version was active, switches the page to the newest
 * remaining version.
 */
export async function handleIterationsDelete(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
  hooks: IterationRouteHooks = {}
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body.ok) {
    sendError(res, 400, body.reason);
    return;
  }
  const parsed = parseDeleteVersionBody(body.value);
  if (!parsed.ok) {
    sendError(res, 400, parsed.reason);
    return;
  }
  const { id, v } = parsed.value;

  const ctx = await resolveCommentIterationContext(
    projectRoot,
    id,
    excludeSrcPrefixes
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.message);
    return;
  }

  if (hasActiveIterationRun(id)) {
    sendError(
      res,
      409,
      "cannot delete an iteration while an iteration is running"
    );
    return;
  }

  const { found, iterationRoots } = ctx;
  const versions = await listCompleteIterationVersionsAllRoots(iterationRoots);
  if (!versions.includes(v)) {
    sendError(res, 400, `version v${v} not found`);
    return;
  }

  const currentActive = found.comment.active ?? 0;
  const wasActive = currentActive === v;
  const remaining = versions.filter((n) => n !== v);
  if (remaining.length === 0) {
    sendError(res, 400, "cannot delete the only remaining version");
    return;
  }

  const targetActive = wasActive ? (remaining.at(-1) ?? 0) : currentActive;

  // Switch the live page before removing artifacts so a failed activate does
  // not leave the comment pointing at a version whose files were deleted.
  if (wasActive) {
    const applied = await applyIterationVersionToSource(
      found,
      iterationRoots,
      id,
      targetActive,
      projectRoot
    );
    if (!applied.ok) {
      sendError(res, applied.status, applied.message);
      return;
    }
    for (const absolutePath of applied.writtenFiles) {
      notifySourceApplied(hooks, {
        absolutePath,
        active: targetActive,
        file: found.relativePath,
        id,
      });
    }
  }

  try {
    await deleteVersionArtifactsAllRoots(iterationRoots, v);
    await deleteVersionAuxFiles(iterationRoots, v);
  } catch (err) {
    sendError(res, 500, errorMessage(err));
    return;
  }

  sendJson(res, {
    ok: true,
    id,
    file: found.relativePath,
    deleted: v,
    active: targetActive,
  });
}

/**
 * POST /api/iterations/new { id }
 *
 * Streams progress to the client as newline-delimited JSON (NDJSON):
 *   - `{type:"progress", stage:"agent", tool?, detail?}` — projected SDK events
 *   - `{type:"progress", stage:"snapshot", detail}` — server post-processing
 *   - `{type:"done", ok:true, ...}` or `{type:"done", ok:false, error}` — final
 *
 * Exactly one `done` event is emitted, then the response is closed. The
 * browser bubble consumes the stream and shows live status.
 *
 * Validation errors (before headers are flushed) still return a JSON error
 * with the appropriate non-200 status; the client only starts NDJSON-parsing
 * after a 200.
 */
export async function handleIterationsNew(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
  hooks: IterationRouteHooks = {}
): Promise<void> {
  const parsed = await readAndParse(req, parseNewIterationBody);
  if (!parsed.ok) {
    sendError(res, parsed.status, parsed.reason);
    return;
  }
  const { id, count, model: requestedModel } = parsed.value;
  const model: AgentModel = requestedModel ?? DEFAULT_AGENT_MODEL_PRIORITY[0];
  const skills = parsed.value.skills ??
    getAgentRuntimeConfig().agentSkills ?? [...DEFAULT_AGENT_SKILLS];

  const ctx = await resolveCommentIterationContext(
    projectRoot,
    id,
    excludeSrcPrefixes
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.message);
    return;
  }

  const startedAt = Date.now();
  const abortController = startIterationRun({
    anchor: ctx.found.comment.anchor,
    commentId: id,
    count,
    model,
    startedAt,
  });

  openNdjsonResponse(res);
  const stream = createNdjsonStream(req, res, {
    abortController,
    abortOnClose: false,
  });
  const originalWriteEvent = stream.writeEvent;
  stream.writeEvent = (event: object) => {
    updateIterationRunStatus(id, iterationProgressStatus(event));
    originalWriteEvent(event);
  };
  try {
    await runNewIteration({
      projectRoot,
      found: ctx.found,
      hooks: {
        ...hooks,
        onInternalSourceWorkFinish: hooks.onInternalSourceWorkFinish,
        onInternalSourceWorkStart: hooks.onInternalSourceWorkStart,
        onVariantScreenshotRequested: waitForVariantScreenshotUpload,
      },
      id,
      count,
      model,
      stream,
      skills,
    });
  } finally {
    finishIterationRun(id, abortController);
  }
}

function iterationProgressStatus(event: object): string | undefined {
  const progress = event as IterationProgressEvent;
  if (progress.type !== "progress") {
    return;
  }
  const { detail, tool } = progress;
  if (tool && detail) {
    return `${tool} ${detail}`;
  }
  return tool ?? detail ?? "Agent working...";
}

/**
 * POST /api/iterations/screenshot { id, v, screenshotPng }
 *
 * Client uploads a version PNG: `v0` baseline before agent work, or `v{N}`
 * after HMR once that variant is applied. Iterate placeholder-copies `v0.png`
 * to new variants until the client overwrites with a fresh capture.
 *
 * Best-effort: a failure here doesn't roll back the iteration.
 */
export async function handleIterationsScreenshot(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[]
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body.ok) {
    sendError(res, 400, body.reason);
    return;
  }
  const parsed = parseScreenshotBody(body.value);
  if (!parsed.ok) {
    sendError(res, 400, parsed.reason);
    return;
  }
  const { id, v, screenshotPng } = parsed.value;

  // Only the comment needs to exist — the iterations dir may not yet (the v0
  // baseline capture fires before the agent run that would create it). Resolve
  // the comment for validation, then ensure the canonical dir below so early
  // captures persist instead of 404-ing on a missing directory.
  const found = await findCommentById(projectRoot, id, excludeSrcPrefixes);
  if (!found) {
    sendError(res, 404, `comment id not found: ${id}`);
    return;
  }

  const bytes = decodeScreenshotPng(screenshotPng);
  if (!bytes) {
    sendError(res, 400, "invalid PNG payload");
    return;
  }

  const iterDir = path.join(projectRoot, "designs", "iterations", id);
  try {
    await mkdir(iterDir, { recursive: true });
    await atomicWriteBytes(path.join(iterDir, `v${v}.png`), bytes);
  } catch (err) {
    sendError(res, 500, errorMessage(err));
    return;
  }
  try {
    await updateVersionScreenshotCaptured(iterDir, v, true);
  } catch (err) {
    console.warn(
      `[vite-plugin-comments] failed to mark v${v}.png captured: ${errorMessage(err)}`
    );
  }
  notifyVariantScreenshotUploaded(id, v);

  const mtimeMs = pngMtimeMs(resolveIterationDirRoots(projectRoot, id), v);

  sendJson(res, {
    ok: true,
    id,
    v,
    png: iterationPngUrl(id, v, mtimeMs),
  });
}
