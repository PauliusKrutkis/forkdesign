import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  collectAllowedTsxFiles,
  type FoundComment,
  findCommentById,
} from "../../comments/find-comment.ts";
import { readCommentsFromFile } from "../../comments/reader.ts";
import {
  appendCommentReply,
  deleteCommentMarker,
  deleteCommentReply,
  updateCommentReply,
  updateCommentResolved,
  updateCommentText,
  type WriteCommentResult,
  writeCommentToFile,
} from "../../comments/writer.ts";
import { WriteError } from "../../comments/writer-errors.ts";
import { applyIterationVersionToSource } from "../../iterations/activate-version.ts";
import { seedBaselineIteration } from "../../iterations/baseline.ts";
import { resolveCommentIterationContext } from "../../iterations/context.ts";
import { readJsonBody, sendError, sendJson } from "../../platform/http.ts";
import { decodeScreenshotPng } from "../../platform/media.ts";
import { resolveSafePagePath } from "../../platform/path-safety.ts";
import { parsePatchBody, parsePostBody } from "./parse-body.ts";

const LEADING_SLASHES_RE = /^\/+/;

async function handleGetAllComments(
  projectRoot: string,
  excludeSrcPrefixes: string[]
): Promise<Record<string, unknown>[]> {
  const files = await collectAllowedTsxFiles(projectRoot, excludeSrcPrefixes);
  const all: Record<string, unknown>[] = [];
  for (const absolutePath of files) {
    const relativePath = path
      .relative(projectRoot, absolutePath)
      .split(path.sep)
      .join(path.posix.sep);
    try {
      const { comments: list, warnings } =
        await readCommentsFromFile(absolutePath);
      for (const w of warnings) {
        console.warn(`[vite-plugin-comments] ${relativePath}: ${w}`);
      }
      for (const c of list) {
        all.push({ ...c, file: relativePath });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[vite-plugin-comments] ${relativePath}: parse error — ${message}`
      );
    }
  }
  return all;
}

function sendJsonOk(res: ServerResponse, body: unknown): void {
  sendJson(res, body);
}

export async function handleGet(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[]
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const file = url.searchParams.get("file");

  // No file param → bulk mode: return comments across all allowed .tsx files
  // under src/. The overlay uses this so comments anchored in shared
  // components (rendered by multiple pages) appear regardless of which page
  // is currently shown.
  if (!file) {
    try {
      const all = await handleGetAllComments(projectRoot, excludeSrcPrefixes);
      sendJsonOk(res, { comments: all });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(res, 500, `scan error: ${message}`);
      return;
    }
  }

  const resolved = resolveSafePagePath(projectRoot, file, excludeSrcPrefixes);
  if (!resolved.ok) {
    sendError(res, 400, resolved.reason);
    return;
  }

  if (
    !(
      existsSync(resolved.absolutePath) &&
      statSync(resolved.absolutePath).isFile()
    )
  ) {
    sendError(res, 404, `file not found: ${file}`);
    return;
  }

  try {
    const { comments: list, warnings } = await readCommentsFromFile(
      resolved.absolutePath
    );

    for (const w of warnings) {
      // Dev-only convenience: surface skipped/dynamic attrs in the terminal so
      // the human can see why an `@comment` directive did not appear in the overlay.
      console.warn(`[vite-plugin-comments] ${file}: ${w}`);
    }

    sendJsonOk(res, {
      file: resolved.relativePath,
      comments: list,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 500, `parse error: ${message}`);
  }
}

export async function handlePost(
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
  const parsed = parsePostBody(body.value);
  if (!parsed.ok) {
    sendError(res, 400, parsed.reason);
    return;
  }

  const resolved = resolveSafePagePath(
    projectRoot,
    parsed.value.file,
    excludeSrcPrefixes
  );
  if (!resolved.ok) {
    sendError(res, 400, resolved.reason);
    return;
  }
  if (
    !(
      existsSync(resolved.absolutePath) &&
      statSync(resolved.absolutePath).isFile()
    )
  ) {
    sendError(res, 404, `file not found: ${parsed.value.file}`);
    return;
  }

  // Pre-mint the comment id so we can derive a stable iteration directory
  // (`public/designs/iterations/<id>/`) BEFORE the writer mutates the file.
  // The baseline file snapshot (`v0.tsx`) is captured AFTER the writer
  // succeeds (see step 5 below) so it includes the freshly-written marker.
  // If v0.tsx lacked the marker, activating v0 later would wipe the marker
  // entirely — bug #24.
  const commentId = randomUUID();

  // Decode and validate the optional screenshot BEFORE running the writer.
  // If the PNG is invalid we log and proceed without it — the comment must
  // succeed even when the screenshot capture didn't.
  let screenshotBytes: Buffer | null = null;
  if (parsed.value.screenshotPng) {
    screenshotBytes = decodeScreenshotPng(parsed.value.screenshotPng);
    if (!screenshotBytes) {
      console.warn(
        "[vite-plugin-comments] screenshotPng was not a valid PNG data URL (or too large); skipping screenshot"
      );
    }
  }
  const willSaveScreenshot = screenshotBytes !== null;
  const screenshotUrl = willSaveScreenshot
    ? `/designs/iterations/${commentId}/v0.png`
    : undefined;

  let result: WriteCommentResult;
  try {
    result = await writeCommentToFile({
      absolutePath: resolved.absolutePath,
      line: parsed.value.line,
      column: parsed.value.column,
      text: parsed.value.text,
      author: parsed.value.author,
      existingAnchor: parsed.value.existingAnchor,
      id: commentId,
      screenshot: screenshotUrl,
      route: parsed.value.route,
    });
  } catch (err) {
    if (err instanceof WriteError) {
      sendError(res, err.status, err.message);
      return;
    }
    sendError(res, 500, err instanceof Error ? err.message : String(err));
    return;
  }

  // Writer succeeded — re-read the post-mutation source so v0.tsx captures
  // the "comment-just-created" state (i.e. WITH the marker present).
  // Activating v0 later then preserves the marker instead of wiping it.
  let baselineSource: string | null = null;
  try {
    baselineSource = await readFile(resolved.absolutePath, "utf8");
  } catch {
    baselineSource = null;
  }

  const savedScreenshotUrl = await seedBaselineIteration(
    projectRoot,
    commentId,
    screenshotBytes,
    baselineSource
  );

  // Recover the `view` slug by re-reading the freshly-written file. The
  // reader is the source of truth for ancestor-walk view resolution; this
  // keeps the response consistent with what GET will report.
  let view: string | null = null;
  try {
    const reread = await readCommentsFromFile(resolved.absolutePath);
    const found = reread.comments.find((c) => c.id === result.id);
    view = found?.view ?? null;
  } catch {
    // Non-fatal: the write succeeded; we just couldn't resolve the view.
    view = null;
  }

  sendJsonOk(res, {
    id: result.id,
    anchor: result.anchor,
    view,
    date: result.date,
    file: resolved.relativePath,
    ...(savedScreenshotUrl ? { screenshot: savedScreenshotUrl } : {}),
  });
}
export async function handlePatch(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[]
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const id = url.pathname.replace(LEADING_SLASHES_RE, "");
  if (id.length === 0) {
    sendError(res, 400, "PATCH /api/comments/:id requires a non-empty id");
    return;
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    sendError(res, 400, body.reason);
    return;
  }
  const parsed = parsePatchBody(body.value);
  if (!parsed.ok) {
    sendError(res, 400, parsed.reason);
    return;
  }

  const found = await findCommentById(projectRoot, id, excludeSrcPrefixes);
  if (!found) {
    sendError(res, 404, `comment id not found: ${id}`);
    return;
  }

  const resolved = resolveSafePagePath(
    projectRoot,
    found.relativePath,
    excludeSrcPrefixes
  );
  if (!resolved.ok) {
    sendError(res, 400, resolved.reason);
    return;
  }

  try {
    if (parsed.value.kind === "text") {
      await updateCommentText({
        absolutePath: resolved.absolutePath,
        commentId: id,
        text: parsed.value.text,
      });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(
        JSON.stringify({
          ok: true,
          id,
          file: resolved.relativePath,
          text: parsed.value.text,
        })
      );
      return;
    }

    if (parsed.value.kind === "reply") {
      const reply = await appendCommentReply({
        absolutePath: resolved.absolutePath,
        commentId: id,
        reply: parsed.value.reply,
      });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(
        JSON.stringify({
          ok: true,
          id,
          file: resolved.relativePath,
          reply,
        })
      );
      return;
    }

    if (parsed.value.kind === "editReply") {
      await updateCommentReply({
        absolutePath: resolved.absolutePath,
        commentId: id,
        replyIndex: parsed.value.replyIndex,
        text: parsed.value.text,
      });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(
        JSON.stringify({
          ok: true,
          id,
          file: resolved.relativePath,
          replyIndex: parsed.value.replyIndex,
          text: parsed.value.text,
        })
      );
      return;
    }

    if (parsed.value.kind === "resolved") {
      await updateCommentResolved({
        absolutePath: resolved.absolutePath,
        commentId: id,
        resolved: parsed.value.resolved,
      });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(
        JSON.stringify({
          ok: true,
          id,
          file: resolved.relativePath,
          resolved: parsed.value.resolved,
        })
      );
      return;
    }

    await deleteCommentReply({
      absolutePath: resolved.absolutePath,
      commentId: id,
      replyIndex: parsed.value.replyIndex,
    });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(
      JSON.stringify({
        ok: true,
        id,
        file: resolved.relativePath,
        replyIndex: parsed.value.replyIndex,
      })
    );
  } catch (err) {
    if (err instanceof WriteError) {
      sendError(res, err.status, err.message);
      return;
    }
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
}

type RevertBeforeDeleteResult =
  | { ok: true; reverted: boolean }
  | { ok: false; status: number; message: string };

async function maybeRevertBeforeDelete(
  projectRoot: string,
  id: string,
  excludeSrcPrefixes: string[],
  found: FoundComment,
  revertParam: string | null
): Promise<RevertBeforeDeleteResult> {
  const currentActive = found.comment.active ?? 0;
  if (revertParam !== "baseline" || currentActive <= 0) {
    return { ok: true, reverted: false };
  }

  const ctx = await resolveCommentIterationContext(
    projectRoot,
    id,
    excludeSrcPrefixes
  );
  if (!ctx.ok) {
    return { ok: false, status: ctx.status, message: ctx.message };
  }

  const applied = await applyIterationVersionToSource(
    ctx.found,
    ctx.iterationRoots,
    id,
    0,
    projectRoot
  );
  if (!applied.ok) {
    return {
      ok: false,
      status: applied.status,
      message: applied.message,
    };
  }

  return { ok: true, reverted: true };
}

export async function handleDelete(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[]
): Promise<void> {
  // The middleware is mounted at `/api/comments`, so `req.url` is the suffix
  // (e.g. "/<id>"). Slice off the leading slash and trim any query string.
  const url = new URL(req.url ?? "", "http://localhost");
  const id = url.pathname.replace(LEADING_SLASHES_RE, "");
  if (id.length === 0) {
    sendError(res, 400, "DELETE /api/comments/:id requires a non-empty id");
    return;
  }

  const found = await findCommentById(projectRoot, id, excludeSrcPrefixes);
  if (!found) {
    sendError(res, 404, `comment id not found: ${id}`);
    return;
  }

  // Path safety: the relative path came off our own filesystem scan, but run
  // it through resolveSafePagePath anyway so any future regression in
  // findCommentById can't be exploited to write outside src/.
  const resolved = resolveSafePagePath(
    projectRoot,
    found.relativePath,
    excludeSrcPrefixes
  );
  if (!resolved.ok) {
    sendError(res, 400, resolved.reason);
    return;
  }

  const revertParam = url.searchParams.get("revert");
  if (revertParam !== null && revertParam !== "baseline") {
    sendError(
      res,
      400,
      'query param `revert` must be "baseline" when provided'
    );
    return;
  }

  let reverted = false;
  const revertResult = await maybeRevertBeforeDelete(
    projectRoot,
    id,
    excludeSrcPrefixes,
    found,
    revertParam
  );
  if (!revertResult.ok) {
    sendError(res, revertResult.status, revertResult.message);
    return;
  }
  reverted = revertResult.reverted;

  let removedAnchor = false;
  try {
    const result = await deleteCommentMarker({
      absolutePath: resolved.absolutePath,
      commentId: id,
    });
    removedAnchor = result.removedAnchor;
  } catch (err) {
    if (err instanceof WriteError) {
      sendError(res, err.status, err.message);
      return;
    }
    sendError(res, 500, err instanceof Error ? err.message : String(err));
    return;
  }

  // Best-effort cleanup of the on-disk iteration artifacts. POST writes
  // screenshots under `public/designs/iterations/<id>/`; the iterate endpoint
  // writes version snapshots under `designs/iterations/<id>/`. Either may be
  // missing — `{ force: true }` swallows ENOENT.
  for (const sub of ["public/designs/iterations", "designs/iterations"]) {
    const dir = path.join(projectRoot, sub, id);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(
        `[vite-plugin-comments] failed to remove ${dir}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(
    JSON.stringify({
      ok: true,
      id,
      file: resolved.relativePath,
      removedAnchor,
      reverted,
    })
  );
}
