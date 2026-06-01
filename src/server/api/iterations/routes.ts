import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  type FoundComment,
  findCommentById,
} from "../../comments/find-comment.ts";
import { readCommentsFromSource } from "../../comments/reader.ts";
import {
  extractDirectiveInner,
  injectExistingMarkerIntoSource,
  replaceCommentMarkerInSource,
  updateCommentActive,
  WriteError,
} from "../../comments/writer.ts";
import { getFixRuntimeConfig } from "../../fix/config.ts";
import {
  buildFixModelChain,
  DEFAULT_FIX_MODEL_PRIORITY,
  parseFixModel,
  runFix,
} from "../../fix/index.ts";
import type { FixModel } from "../../fix/models.ts";

const VERSION_TSX_FILE_RE = /^v(\d+)\.tsx$/;

import {
  deleteVersionArtifactsAllRoots,
  enrichVersionMeta,
  findVersionPngPath,
  findVersionSnapshotPath,
  iterationPngUrl,
  listCompleteIterationVersionsAllRoots,
  patchIterationsManifest,
  pngMtimeMs,
  readIterationsManifest,
  resolveIterationDirRoots,
  tsxMtimeMs,
  versionEntryFromManifest,
} from "../../iterations/manifest.ts";
import {
  atomicWriteBytes,
  atomicWriteText,
} from "../../platform/atomic-write.ts";
import { readJsonBody, sendError } from "../../platform/http.ts";
import { decodeScreenshotPng } from "../comments/parse-body.ts";
import {
  parseActivateBody,
  parseDeleteVersionBody,
  parseScreenshotBody,
} from "./parse-body.ts";

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

  const found = await findCommentById(projectRoot, id, excludeSrcPrefixes);
  if (!found) {
    sendError(res, 404, `comment id not found: ${id}`);
    return;
  }

  const iterationRoots = resolveIterationDirRoots(projectRoot, id);
  if (iterationRoots.length === 0) {
    sendError(res, 404, `iterations dir not found: ${id}`);
    return;
  }

  const iterDir = iterationRoots[0];
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
    };
  });

  const active = found.comment.active ?? 0;

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(
    JSON.stringify({
      id,
      file: found.relativePath,
      active,
      versions,
    })
  );
}

type IterationApplyResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

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

async function applyIterationVersionToSource(
  found: FoundComment,
  iterationRoots: string[],
  id: string,
  v: number
): Promise<IterationApplyResult> {
  const snapshotPath = findVersionSnapshotPath(iterationRoots, v);
  if (!snapshotPath) {
    return {
      ok: false,
      status: 400,
      message: `version snapshot not found: v${v}.tsx`,
    };
  }

  if (found.siblingIds.length > 0) {
    console.warn(
      `[vite-plugin-comments] activating v${v} for comment ${id} will overwrite ${found.siblingIds.length} other comment(s) in ${found.relativePath}`
    );
  }

  let currentSource: string;
  try {
    currentSource = await readFile(found.absolutePath, "utf8");
  } catch (err) {
    return {
      ok: false,
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const directiveInner = extractDirectiveInner(currentSource, id);
  if (directiveInner === null) {
    return {
      ok: false,
      status: 500,
      message: `could not extract directive for comment ${id} from current source`,
    };
  }

  let snapshotSource: string;
  try {
    snapshotSource = await readFile(snapshotPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  let snapshotHasMarker = false;
  try {
    const parsedSnapshot = readCommentsFromSource(snapshotSource);
    snapshotHasMarker = parsedSnapshot.comments.some((c) => c.id === id);
  } catch {
    snapshotHasMarker = false;
  }

  try {
    if (snapshotHasMarker) {
      snapshotSource = replaceCommentMarkerInSource(
        snapshotSource,
        id,
        directiveInner
      );
    } else if (
      snapshotSource.includes(`data-comment-anchor="${found.comment.anchor}"`)
    ) {
      snapshotSource = injectExistingMarkerIntoSource(
        snapshotSource,
        found.comment.anchor,
        directiveInner
      );
      console.warn(
        `[vite-plugin-comments] injected marker into v${v} snapshot of comment ${id} before activating (snapshot pre-dated the marker)`
      );
    } else {
      return {
        ok: false,
        status: 400,
        message:
          "snapshot is too old to safely activate; it pre-dates the anchor attribute.",
      };
    }
  } catch (err) {
    if (err instanceof WriteError) {
      return { ok: false, status: err.status, message: err.message };
    }
    return {
      ok: false,
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await atomicWriteText(found.absolutePath, snapshotSource);
  } catch (err) {
    return {
      ok: false,
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await updateCommentActive({
      absolutePath: found.absolutePath,
      commentId: id,
      active: v,
    });
  } catch (err) {
    if (err instanceof WriteError) {
      return { ok: false, status: err.status, message: err.message };
    }
    return {
      ok: false,
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  return { ok: true };
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
  excludeSrcPrefixes: string[]
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
  const { id, v } = parsed.value;

  const found = await findCommentById(projectRoot, id, excludeSrcPrefixes);
  if (!found) {
    sendError(res, 404, `comment id not found: ${id}`);
    return;
  }

  const iterationRoots = resolveIterationDirRoots(projectRoot, id);
  if (iterationRoots.length === 0) {
    sendError(res, 404, `iterations dir not found: ${id}`);
    return;
  }

  const applied = await applyIterationVersionToSource(
    found,
    iterationRoots,
    id,
    v
  );
  if (!applied.ok) {
    sendError(res, applied.status, applied.message);
    return;
  }

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(
    JSON.stringify({
      ok: true,
      id,
      file: found.relativePath,
      active: v,
    })
  );
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
  excludeSrcPrefixes: string[]
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

  const found = await findCommentById(projectRoot, id, excludeSrcPrefixes);
  if (!found) {
    sendError(res, 404, `comment id not found: ${id}`);
    return;
  }

  const iterationRoots = resolveIterationDirRoots(projectRoot, id);
  if (iterationRoots.length === 0) {
    sendError(res, 404, `iterations dir not found: ${id}`);
    return;
  }

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
      targetActive
    );
    if (!applied.ok) {
      sendError(res, applied.status, applied.message);
      return;
    }
  }

  try {
    await deleteVersionArtifactsAllRoots(iterationRoots, v);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : String(err));
    return;
  }

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(
    JSON.stringify({
      ok: true,
      id,
      file: found.relativePath,
      deleted: v,
      active: targetActive,
    })
  );
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
  excludeSrcPrefixes: string[]
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body.ok) {
    sendError(res, 400, body.reason);
    return;
  }
  if (!body.value || typeof body.value !== "object") {
    sendError(res, 400, "body must be a JSON object");
    return;
  }
  const id = (body.value as Record<string, unknown>).id;
  if (typeof id !== "string" || id.length === 0) {
    sendError(res, 400, "field `id` must be a non-empty string");
    return;
  }

  let model: FixModel = "composer-2.5-fast";
  const rawModel = (body.value as Record<string, unknown>).model;
  if (rawModel !== undefined) {
    const parsed = parseFixModel(rawModel);
    if (!parsed) {
      sendError(res, 400, "field `model` must be a supported fix model id");
      return;
    }
    model = parsed;
  }

  const found = await findCommentById(projectRoot, id, excludeSrcPrefixes);
  if (!found) {
    sendError(res, 404, `comment id not found: ${id}`);
    return;
  }

  // ----- Open the NDJSON stream --------------------------------------------
  // Once headers are flushed we can no longer surface a non-200 to the client
  // through res.statusCode — every subsequent failure must be reported as a
  // `done` event with ok:false.
  res.statusCode = 200;
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  // Some Connect middleware buffers the first chunk if headers aren't
  // explicitly flushed — call flushHeaders so consumers see headers
  // immediately. Optional chaining handles older Node / test mocks.
  res.flushHeaders?.();

  // Abort plumbing: if the client closes the connection mid-stream, abort
  // the agent (otherwise we'd keep burning tokens for a dead consumer).
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

  // Initial heartbeat so the client sees activity immediately, before the
  // SDK has emitted anything.
  writeEvent({ type: "progress", stage: "agent", detail: "dispatching" });

  const fixStartedAt = Date.now();
  const priority =
    getFixRuntimeConfig().fixModelPriority ?? DEFAULT_FIX_MODEL_PRIORITY;
  const modelChain = buildFixModelChain(model, priority);

  // ----- Step 1: snapshot the source BEFORE the agent runs -----------------
  let beforeSource: string;
  try {
    beforeSource = await readFile(found.absolutePath, "utf8");
  } catch (err) {
    endStream({
      type: "done",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // ----- Step 2: invoke the fix strategy chain ------------------------------
  console.info(
    `[vite-plugin-comments] dispatching fix model=${model} chain=[${modelChain.join(", ")}] comment=${id} file=${found.relativePath}`
  );

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
    signal: abortController.signal,
    onEvent: (e) => {
      if (e.kind === "tool_use_summary" && e.detail) {
        lastAgentSummary = e.detail;
      } else if (e.detail) {
        lastAgentSummary = lastAgentSummary ?? e.detail;
      }
      writeEvent({
        type: "progress",
        stage: "agent",
        ...(e.tool ? { tool: e.tool } : {}),
        ...(e.detail ? { detail: e.detail } : {}),
      });
    },
  });

  if (clientGone) {
    // Client bailed mid-run; nothing more to write.
    return;
  }

  if (!agentResult.ok) {
    endStream({ type: "done", ok: false, error: agentResult.error });
    return;
  }

  const durationMs = Date.now() - fixStartedAt;
  const modelUsed = agentResult.modelUsed;

  // ----- Step 3: read post-edit source --------------------------------------
  writeEvent({
    type: "progress",
    stage: "snapshot",
    detail: "reading post-edit source",
  });

  let afterSource: string;
  try {
    afterSource = await readFile(found.absolutePath, "utf8");
  } catch (err) {
    endStream({
      type: "done",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (afterSource === beforeSource) {
    // No-op iteration: agent ran successfully but didn't change the file.
    // Don't burn a version slot — just report back.
    endStream({
      type: "done",
      ok: true,
      id,
      changed: false,
      modelUsed,
      durationMs,
      turnsUsed: agentResult.turnsUsed,
      toolCalls: agentResult.toolCalls,
    });
    return;
  }

  // ----- Step 4: snapshot the AFTER state as v{N+1}.tsx --------------------
  const iterDir = path.join(projectRoot, "designs", "iterations", id);
  let nextV = 1;
  try {
    if (existsSync(iterDir) && statSync(iterDir).isDirectory()) {
      const entries = await readdir(iterDir);
      let max = -1;
      for (const name of entries) {
        const m = name.match(VERSION_TSX_FILE_RE);
        if (!m) {
          continue;
        }
        const version = m[1];
        if (version === undefined) {
          continue;
        }
        const n = Number.parseInt(version, 10);
        if (Number.isFinite(n) && n > max) {
          max = n;
        }
      }
      nextV = max >= 0 ? max + 1 : 1;
    } else {
      await mkdir(iterDir, { recursive: true });
    }
  } catch (err) {
    endStream({
      type: "done",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const nextTsx = path.join(iterDir, `v${nextV}.tsx`);
  const nextPng = path.join(iterDir, `v${nextV}.png`);
  const iterationRoots = resolveIterationDirRoots(projectRoot, id);

  writeEvent({
    type: "progress",
    stage: "snapshot",
    detail: `writing v${nextV}.tsx`,
  });

  try {
    await atomicWriteText(nextTsx, afterSource);
  } catch (err) {
    endStream({
      type: "done",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Best-effort PNG copy (baseline may live under public/ from comment POST).
  // Real re-screenshot of the new visual state is a separate client follow-up.
  try {
    const v0Png = findVersionPngPath(iterationRoots, 0);
    if (v0Png) {
      await copyFile(v0Png, nextPng);
    }
  } catch (err) {
    console.warn(
      `[vite-plugin-comments] failed to copy v0.png → v${nextV}.png: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  writeEvent({
    type: "progress",
    stage: "snapshot",
    detail: `setting active=${nextV}`,
  });

  try {
    await updateCommentActive({
      absolutePath: found.absolutePath,
      commentId: id,
      active: nextV,
    });
  } catch (err) {
    let message: string;
    if (err instanceof WriteError) {
      message = err.message;
    } else if (err instanceof Error) {
      message = err.message;
    } else {
      message = String(err);
    }
    endStream({ type: "done", ok: false, error: message });
    return;
  }

  try {
    const summary = lastAgentSummary?.trim() || `Fix v${nextV}`;
    await patchIterationsManifest(iterDir, nextV, {
      summary,
      createdAt: new Date().toISOString(),
    });
  } catch (manifestErr) {
    console.warn(
      `[vite-plugin-comments] failed to write iteration manifest: ${manifestErr instanceof Error ? manifestErr.message : String(manifestErr)}`
    );
  }

  endStream({
    type: "done",
    ok: true,
    id,
    changed: true,
    v: nextV,
    tsx: `/designs/iterations/${id}/v${nextV}.tsx`,
    png: iterationPngUrl(id, nextV, pngMtimeMs(iterationRoots, nextV)),
    modelUsed,
    durationMs,
    turnsUsed: agentResult.turnsUsed,
    toolCalls: agentResult.toolCalls,
  });
}

/**
 * POST /api/iterations/screenshot { id, v, screenshotPng }
 *
 * Client-side follow-up to `POST /api/iterations/new`: the iterate endpoint
 * placeholder-copies `v0.png` to `v{N}.png`, but that PNG is visually wrong
 * since the design just changed. The browser re-captures the now-edited
 * element after HMR settles and POSTs the fresh PNG here. We overwrite the
 * placeholder atomically.
 *
 * Best-effort: a failure here doesn't roll back the iteration. The placeholder
 * stays in place and the user keeps a slightly-stale screenshot.
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

  const found = await findCommentById(projectRoot, id, excludeSrcPrefixes);
  if (!found) {
    sendError(res, 404, `comment id not found: ${id}`);
    return;
  }

  const iterDir = path.join(projectRoot, "designs", "iterations", id);
  if (!(existsSync(iterDir) && statSync(iterDir).isDirectory())) {
    sendError(res, 404, `iterations dir not found: ${id}`);
    return;
  }

  const bytes = decodeScreenshotPng(screenshotPng);
  if (!bytes) {
    sendError(res, 400, "invalid PNG payload");
    return;
  }

  const pngPath = path.join(iterDir, `v${v}.png`);
  try {
    await atomicWriteBytes(pngPath, bytes);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : String(err));
    return;
  }

  const mtimeMs = pngMtimeMs([iterDir], v);

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(
    JSON.stringify({
      ok: true,
      id,
      v,
      png: iterationPngUrl(id, v, mtimeMs),
    })
  );
}
