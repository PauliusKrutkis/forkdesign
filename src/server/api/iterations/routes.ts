import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { getAgentRuntimeConfig } from "../../agent/config.ts";
import {
  type AgentModel,
  DEFAULT_AGENT_MODEL_PRIORITY,
} from "../../agent/models.ts";
import { DEFAULT_AGENT_SKILLS } from "../../agent/skills.ts";
import { applyIterationVersionToSource } from "../../iterations/activate-version.ts";
import { resolveCommentIterationContext } from "../../iterations/context.ts";
import {
  deleteVersionArtifactsAllRoots,
  enrichVersionMeta,
  iterationPngUrl,
  listCompleteIterationVersionsAllRoots,
  pngMtimeMs,
  readIterationsManifest,
  tsxMtimeMs,
  versionEntryFromManifest,
} from "../../iterations/manifest.ts";
import {
  createNdjsonStream,
  openNdjsonResponse,
  runNewIteration,
} from "../../iterations/run-iteration.ts";
import { atomicWriteBytes } from "../../platform/atomic-write.ts";
import {
  errorMessage,
  readAndParse,
  readJsonBody,
  sendError,
  sendJson,
} from "../../platform/http.ts";
import { decodeScreenshotPng } from "../../platform/media.ts";
import {
  parseActivateBody,
  parseDeleteVersionBody,
  parseNewIterationBody,
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
      ...(meta.runId ? { runId: meta.runId } : {}),
    };
  });

  const active = found.comment.active ?? 0;

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

  const ctx = await resolveCommentIterationContext(
    projectRoot,
    id,
    excludeSrcPrefixes
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.message);
    return;
  }

  const applied = await applyIterationVersionToSource(
    ctx.found,
    ctx.iterationRoots,
    id,
    v
  );
  if (!applied.ok) {
    sendError(res, applied.status, applied.message);
    return;
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

  const ctx = await resolveCommentIterationContext(
    projectRoot,
    id,
    excludeSrcPrefixes
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.message);
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
  excludeSrcPrefixes: string[]
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

  openNdjsonResponse(res);
  const stream = createNdjsonStream(req, res);
  await runNewIteration({
    projectRoot,
    found: ctx.found,
    id,
    count,
    model,
    stream,
    skills,
  });
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

  const ctx = await resolveCommentIterationContext(
    projectRoot,
    id,
    excludeSrcPrefixes
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.message);
    return;
  }

  const bytes = decodeScreenshotPng(screenshotPng);
  if (!bytes) {
    sendError(res, 400, "invalid PNG payload");
    return;
  }

  const pngPath = path.join(ctx.iterDir, `v${v}.png`);
  try {
    await atomicWriteBytes(pngPath, bytes);
  } catch (err) {
    sendError(res, 500, errorMessage(err));
    return;
  }

  const mtimeMs = pngMtimeMs(ctx.iterationRoots, v);

  sendJson(res, {
    ok: true,
    id,
    v,
    png: iterationPngUrl(id, v, mtimeMs),
  });
}
