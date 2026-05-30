/**
 * vite-plugin-comments — dev-only plugin for the inline comment bubble system.
 *
 * Scope (W4 read + write paths):
 *   - `GET /api/comments?file=src/pages/<Page>.tsx` → parse the requested .tsx
 *     and return its `{/* @comment ... *\/}` markers as JSON.
 *   - `POST /api/comments` → insert a new `{/* @comment ... *\/}` marker into
 *     the requested file (Babel AST mutation through recast). Stamps a
 *     `data-comment-anchor` on the target element when missing.
 *   - Injects a single HTML marker comment in dev so we can verify the plugin
 *     is active by viewing the page source.
 *
 * Out of scope (later tasks):
 *   - Screenshot capture + per-view HTML history snapshots → task #8.
 *   - Mounting an overlay script: Agent C mounts the React overlay from
 *     `src/App.tsx`. We intentionally do not inject a `<script>` tag here.
 *
 * Constraints:
 *   - `apply: 'serve'` — never runs during `vite build`.
 *   - Read-only middleware; no caching (re-parse per request, fine for dev).
 *   - Path traversal hardening: only files under `<projectRoot>/src/pages/`
 *     that end in `.tsx` are readable/writable. Anything else → 400.
 */
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  readCommentsFromFile,
  readCommentsFromSource,
} from "./babel-comment-reader.ts";
import {
  appendCommentReply,
  deleteCommentMarker,
  deleteCommentReply,
  extractDirectiveInner,
  injectExistingMarkerIntoSource,
  updateCommentActive,
  updateCommentReply,
  updateCommentText,
  writeCommentToFile,
  WriteError,
} from "./babel-comment-writer.ts";
import { copyFile, readdir } from "node:fs/promises";
import {
  configureFixRuntime,
  parseFixModel,
  runFix,
  type FixModel,
} from "./fix/index.ts";

const INJECT_MARKER = "<!-- vite-plugin-comments injected -->";
const SRC_REL = "src";
/**
 * Directories under src/ that may NOT receive comment markers. These are the
 * comment overlay's own infrastructure — writing markers into them would
 * either recurse (comments commenting on the comment system) or affect the
 * dev server pipeline itself.
 */
export type CommentsPluginOptions = {
  /**
   * Project-relative `src/` prefixes to skip when reading/writing comments
   * (e.g. overlay infrastructure or dev-only routes in your app).
   */
  excludeSrcPrefixes?: string[];
  /** Path to the Cursor CLI `agent` binary. Default: `"agent"` (must be on PATH). */
  cursorAgentPath?: string;
};

export function comments(options: CommentsPluginOptions = {}): Plugin {
  const excludeSrcPrefixes = options.excludeSrcPrefixes ?? [];
  const cursorAgentPath = options.cursorAgentPath;
  let projectRoot = process.cwd();

  return {
    name: "vite-plugin-comments",
    apply: "serve",

    configResolved(config) {
      projectRoot = config.root;
      configureFixRuntime({
        ...(cursorAgentPath ? { cursorAgentPath } : {}),
      });
    },

    configureServer(server) {
      server.middlewares.use("/api/comments", (req, res, next) => {
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method === "GET") {
          handleGet(req, res, projectRoot, excludeSrcPrefixes).catch((err: unknown) => {
            // Never let a thrown rejection crash the dev server.
            sendError(
              res,
              500,
              err instanceof Error ? err.message : String(err),
            );
          });
          return;
        }
        if (req.method === "POST") {
          handlePost(req, res, projectRoot, excludeSrcPrefixes).catch((err: unknown) => {
            sendError(
              res,
              500,
              err instanceof Error ? err.message : String(err),
            );
          });
          return;
        }
        if (req.method === "DELETE") {
          handleDelete(req, res, projectRoot, excludeSrcPrefixes).catch((err: unknown) => {
            sendError(
              res,
              500,
              err instanceof Error ? err.message : String(err),
            );
          });
          return;
        }
        if (req.method === "PATCH") {
          handlePatch(req, res, projectRoot, excludeSrcPrefixes).catch((err: unknown) => {
            sendError(
              res,
              500,
              err instanceof Error ? err.message : String(err),
            );
          });
          return;
        }
        // Defer to the next handler so unrelated routes still work.
        next();
      });

      // ----- /api/iterations* — version switcher (task #9) ------------------
      server.middlewares.use("/api/iterations", (req, res, next) => {
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        // Distinguish the three routes by URL path. The middleware mount
        // strips the `/api/iterations` prefix, so we look at the remainder.
        const url = new URL(req.url ?? "", "http://localhost");
        const sub = url.pathname; // e.g. "", "/", "/activate", "/new"

        if (req.method === "GET" && (sub === "" || sub === "/")) {
          handleIterationsList(req, res, projectRoot, excludeSrcPrefixes).catch((err: unknown) => {
            sendError(res, 500, err instanceof Error ? err.message : String(err));
          });
          return;
        }
        if (req.method === "POST" && sub === "/activate") {
          handleIterationsActivate(req, res, projectRoot, excludeSrcPrefixes).catch((err: unknown) => {
            sendError(res, 500, err instanceof Error ? err.message : String(err));
          });
          return;
        }
        if (req.method === "POST" && sub === "/new") {
          handleIterationsNew(req, res, projectRoot, excludeSrcPrefixes).catch((err: unknown) => {
            // handleIterationsNew streams NDJSON: once headers are flushed we
            // can't use sendError (it sets headers). If headers haven't been
            // sent yet, fall back to a 500. Otherwise emit a terminal `done`
            // event with the error and close the stream.
            const message = err instanceof Error ? err.message : String(err);
            if (res.headersSent) {
              try {
                res.write(`${JSON.stringify({ type: "done", ok: false, error: message })}\n`);
              } catch {
                /* socket already gone */
              }
              try {
                res.end();
              } catch {
                /* already closed */
              }
            } else {
              sendError(res, 500, message);
            }
          });
          return;
        }
        if (req.method === "POST" && sub === "/screenshot") {
          handleIterationsScreenshot(req, res, projectRoot, excludeSrcPrefixes).catch(
            (err: unknown) => {
              sendError(
                res,
                500,
                err instanceof Error ? err.message : String(err),
              );
            },
          );
          return;
        }
        next();
      });
    },

    transformIndexHtml: {
      order: "pre",
      handler(html) {
        // Idempotent: don't double-inject if HMR re-runs this hook.
        if (html.includes(INJECT_MARKER)) return html;
        return html.replace("</head>", `  ${INJECT_MARKER}\n  </head>`);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

async function handleGet(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const file = url.searchParams.get("file");

  // No file param → bulk mode: return comments across all allowed .tsx files
  // under src/. The overlay uses this so comments anchored in shared
  // components (rendered by multiple pages) appear regardless of which page
  // is currently shown.
  if (!file) {
    try {
      const files = await collectAllowedTsxFiles(
        projectRoot,
        excludeSrcPrefixes,
      );
      const all: Array<Record<string, unknown>> = [];
      for (const absolutePath of files) {
        const relativePath = path
          .relative(projectRoot, absolutePath)
          .split(path.sep)
          .join(path.posix.sep);
        try {
          const { comments: list, warnings } =
            await readCommentsFromFile(absolutePath);
          for (const w of warnings) {
            // eslint-disable-next-line no-console
            console.warn(`[vite-plugin-comments] ${relativePath}: ${w}`);
          }
          for (const c of list) {
            all.push({ ...c, file: relativePath });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.warn(
            `[vite-plugin-comments] ${relativePath}: parse error — ${message}`,
          );
        }
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify({ comments: all }));
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

  if (!existsSync(resolved.absolutePath) || !statSync(resolved.absolutePath).isFile()) {
    sendError(res, 404, `file not found: ${file}`);
    return;
  }

  try {
    const { comments: list, warnings } = await readCommentsFromFile(
      resolved.absolutePath,
    );

    for (const w of warnings) {
      // Dev-only convenience: surface skipped/dynamic attrs in the terminal so
      // the human can see why an `@comment` directive did not appear in the overlay.
      // eslint-disable-next-line no-console
      console.warn(`[vite-plugin-comments] ${file}: ${w}`);
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(
      JSON.stringify({
        file: resolved.relativePath,
        comments: list,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 500, `parse error: ${message}`);
  }
}

/**
 * Recursively walk `src/` for .tsx files, skipping excluded directories.
 */
async function collectAllowedTsxFiles(
  projectRoot: string,
  excludeSrcPrefixes: string[],
): Promise<string[]> {
  const srcAbs = path.resolve(projectRoot, SRC_REL);
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const rel = path
      .relative(projectRoot, dir)
      .split(path.sep)
      .join(path.posix.sep);
    if (excludeSrcPrefixes.some((p) => `${rel}/`.startsWith(p))) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
        const relFile = path
          .relative(projectRoot, full)
          .split(path.sep)
          .join(path.posix.sep);
        if (excludeSrcPrefixes.some((p) => relFile.startsWith(p))) continue;
        out.push(full);
      }
    }
  }
  await walk(srcAbs);
  return out;
}

async function handlePost(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
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
    excludeSrcPrefixes,
  );
  if (!resolved.ok) {
    sendError(res, 400, resolved.reason);
    return;
  }
  if (
    !existsSync(resolved.absolutePath) ||
    !statSync(resolved.absolutePath).isFile()
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
      // eslint-disable-next-line no-console
      console.warn(
        "[vite-plugin-comments] screenshotPng was not a valid PNG data URL (or too large); skipping screenshot",
      );
    }
  }
  const willSaveScreenshot = screenshotBytes !== null;
  const screenshotUrl = willSaveScreenshot
    ? `/designs/iterations/${commentId}/v0.png`
    : undefined;

  let result;
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

  // Persist the iteration artifacts. Failures here are logged but don't fail
  // the request; the comment marker is already on disk.
  let savedScreenshotUrl: string | null = null;
  if (willSaveScreenshot || baselineSource !== null) {
    try {
      const iterDir = path.join(
        projectRoot,
        "public",
        "designs",
        "iterations",
        commentId,
      );
      await mkdir(iterDir, { recursive: true });
      if (screenshotBytes) {
        await atomicWriteBytes(path.join(iterDir, "v0.png"), screenshotBytes);
        savedScreenshotUrl = `/designs/iterations/${commentId}/v0.png`;
      }
      if (baselineSource !== null) {
        await atomicWriteText(
          path.join(iterDir, "v0.tsx"),
          baselineSource,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[vite-plugin-comments] failed to write iteration artifacts: ${err instanceof Error ? err.message : String(err)}`,
      );
      savedScreenshotUrl = null;
    }
  }

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

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(
    JSON.stringify({
      id: result.id,
      anchor: result.anchor,
      view,
      date: result.date,
      file: resolved.relativePath,
      ...(savedScreenshotUrl ? { screenshot: savedScreenshotUrl } : {}),
    }),
  );
}

// ---------------------------------------------------------------------------
// PATCH /api/comments/:id — edit comment text or append a flat reply
// ---------------------------------------------------------------------------

async function handlePatch(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const id = url.pathname.replace(/^\/+/, "");
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
    excludeSrcPrefixes,
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
        }),
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
        }),
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
        }),
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
      }),
    );
  } catch (err) {
    if (err instanceof WriteError) {
      sendError(res, err.status, err.message);
      return;
    }
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/comments/:id — comment management panel (task #20)
//
// Removes the `{/* @comment id="..." *\/}` block from source via the writer
// helper, deletes the on-disk iteration directory at
// `public/designs/iterations/<id>/` (where the POST handler saved
// screenshots), and reports whether the surviving anchor attribute was also
// stripped. The HMR cycle picks up the file mutation and the client overlay
// re-fetches its bulk comment list naturally.
//
// We also try to delete the same directory under `designs/iterations/<id>/`
// (where /api/iterations/new writes versioned snapshots) so a comment's
// version history doesn't linger after the comment itself is gone. Both
// removals use `rm` with `{ recursive: true, force: true }` so a missing
// directory is non-fatal.
// ---------------------------------------------------------------------------

async function handleDelete(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
): Promise<void> {
  // The middleware is mounted at `/api/comments`, so `req.url` is the suffix
  // (e.g. "/<id>"). Slice off the leading slash and trim any query string.
  const url = new URL(req.url ?? "", "http://localhost");
  const id = url.pathname.replace(/^\/+/, "");
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
    excludeSrcPrefixes,
  );
  if (!resolved.ok) {
    sendError(res, 400, resolved.reason);
    return;
  }

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
      // eslint-disable-next-line no-console
      console.warn(
        `[vite-plugin-comments] failed to remove ${dir}: ${err instanceof Error ? err.message : String(err)}`,
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
    }),
  );
}

// ---------------------------------------------------------------------------
// /api/iterations* — version switcher (task #9)
//
// All three endpoints share the same lookup primitive: given a `comment-id`,
// scan every allowed .tsx file under src/ and find the file containing the
// marker. The scan is cheap (handful of pages) and gives us the same path
// safety as the existing endpoints.
//
// CAVEAT: `POST /api/iterations/activate` overwrites the WHOLE target file
// with a saved snapshot. If the file currently contains other `@comment`
// markers (or any other edits) made since the snapshot was taken, those
// edits are clobbered. The architectural mitigation is a soft lock at the
// UI layer ("one iteration in progress at a time") — NOT enforced here. We
// log a warning to the terminal when the file contains other markers so the
// human can see what's about to be lost.
// ---------------------------------------------------------------------------

type FoundComment = {
  absolutePath: string;
  relativePath: string;
  comment: {
    id: string;
    anchor: string;
    text: string;
    screenshot?: string;
    view?: string;
    active?: number;
  };
  /** ids of OTHER @comment markers in the same file (for the activate warning). */
  siblingIds: string[];
};

/**
 * Walk all allowed .tsx files under src/ and find the one carrying the marker
 * with `id === commentId`. Returns null when no file owns the id.
 */
async function findCommentById(
  projectRoot: string,
  commentId: string,
  excludeSrcPrefixes: string[],
): Promise<FoundComment | null> {
  const files = await collectAllowedTsxFiles(projectRoot, excludeSrcPrefixes);
  for (const absolutePath of files) {
    let result;
    try {
      result = await readCommentsFromFile(absolutePath);
    } catch {
      continue;
    }
    const match = result.comments.find((c) => c.id === commentId);
    if (!match) continue;
    const relativePath = path
      .relative(projectRoot, absolutePath)
      .split(path.sep)
      .join(path.posix.sep);
    return {
      absolutePath,
      relativePath,
      comment: {
        id: match.id,
        anchor: match.anchor,
        text: match.text,
        screenshot: match.screenshot,
        view: match.view ?? undefined,
        active: match.active,
      },
      siblingIds: result.comments
        .filter((c) => c.id !== commentId)
        .map((c) => c.id),
    };
  }
  return null;
}

/**
 * GET /api/iterations?id=<comment-id>
 *
 * Reads the iterations directory on disk and returns the list of versions
 * where BOTH the v{N}.tsx snapshot and v{N}.png screenshot exist. Sorted
 * ascending by N. `active` is read off the @comment marker (defaults to 0
 * when the attribute is absent).
 */
async function handleIterationsList(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
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

  const iterDir = path.join(projectRoot, "designs", "iterations", id);
  if (!existsSync(iterDir) || !statSync(iterDir).isDirectory()) {
    sendError(res, 404, `iterations dir not found: ${id}`);
    return;
  }

  let entries: string[];
  try {
    entries = await readdir(iterDir);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : String(err));
    return;
  }

  // Collect the (v=N, hasTsx, hasPng) set in one pass.
  const present: Map<number, { tsx: boolean; png: boolean }> = new Map();
  for (const name of entries) {
    const m = name.match(/^v(\d+)\.(tsx|png)$/);
    if (!m) continue;
    const n = Number.parseInt(m[1]!, 10);
    if (!Number.isFinite(n)) continue;
    const slot = present.get(n) ?? { tsx: false, png: false };
    if (m[2] === "tsx") slot.tsx = true;
    else slot.png = true;
    present.set(n, slot);
  }

  const versions = [...present.entries()]
    .filter(([, slot]) => slot.tsx && slot.png)
    .map(([n]) => n)
    .sort((a, b) => a - b)
    .map((n) => ({
      v: n,
      tsx: `/designs/iterations/${id}/v${n}.tsx`,
      png: `/designs/iterations/${id}/v${n}.png`,
    }));

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
    }),
  );
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
async function handleIterationsActivate(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
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

  const snapshotPath = path.join(
    projectRoot,
    "designs",
    "iterations",
    id,
    `v${v}.tsx`,
  );
  if (!existsSync(snapshotPath) || !statSync(snapshotPath).isFile()) {
    sendError(res, 400, `version snapshot not found: v${v}.tsx`);
    return;
  }

  // Warn loudly when there are other markers in this file — they will be
  // overwritten by the snapshot's contents.
  if (found.siblingIds.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[vite-plugin-comments] activating v${v} for comment ${id} will overwrite ${found.siblingIds.length} other comment(s) in ${found.relativePath}`,
    );
  }

  let snapshotSource: string;
  try {
    snapshotSource = await readFile(snapshotPath, "utf8");
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : String(err));
    return;
  }

  // Defensive: legacy v0.tsx snapshots (captured before bug #24 was fixed)
  // don't contain the @comment marker. If we just wrote them as-is, we'd
  // wipe the marker entirely. Detect this by parsing the snapshot and
  // checking for the activating comment id.
  let snapshotHasMarker = false;
  try {
    const parsed = readCommentsFromSource(snapshotSource);
    snapshotHasMarker = parsed.comments.some((c) => c.id === id);
  } catch {
    // If the snapshot is unparsable we'll let the downstream write attempt
    // surface the error in a clearer way.
    snapshotHasMarker = false;
  }

  if (!snapshotHasMarker) {
    // We need to re-inject the marker into the snapshot. Two prerequisites:
    //   1. The snapshot must still carry `data-comment-anchor="<anchor>"`
    //      on some element (otherwise we have no insertion point).
    //   2. The CURRENT source file must contain the marker for `id`, so we
    //      can pull the verbatim directive text from it.
    if (!snapshotSource.includes(`data-comment-anchor="${found.comment.anchor}"`)) {
      sendError(
        res,
        400,
        "snapshot is too old to safely activate; it pre-dates the anchor attribute.",
      );
      return;
    }
    let currentSource: string;
    try {
      currentSource = await readFile(found.absolutePath, "utf8");
    } catch (err) {
      sendError(res, 500, err instanceof Error ? err.message : String(err));
      return;
    }
    const directiveInner = extractDirectiveInner(currentSource, id);
    if (directiveInner === null) {
      sendError(
        res,
        500,
        `could not extract directive for comment ${id} from current source`,
      );
      return;
    }
    try {
      snapshotSource = injectExistingMarkerIntoSource(
        snapshotSource,
        found.comment.anchor,
        directiveInner,
      );
    } catch (err) {
      if (err instanceof WriteError) {
        sendError(res, err.status, err.message);
        return;
      }
      sendError(res, 500, err instanceof Error ? err.message : String(err));
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[vite-plugin-comments] injected marker into v${v} snapshot of comment ${id} before activating (snapshot pre-dated the marker)`,
    );
  }

  // Step 1: replace the source file with the snapshot. Atomic.
  try {
    await atomicWriteText(found.absolutePath, snapshotSource);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : String(err));
    return;
  }

  // Step 2: stamp `active=v` on the marker. The snapshot may or may not
  // already carry the right value (depends on when it was captured), so we
  // re-write unconditionally.
  try {
    await updateCommentActive({
      absolutePath: found.absolutePath,
      commentId: id,
      active: v,
    });
  } catch (err) {
    if (err instanceof WriteError) {
      sendError(res, err.status, err.message);
      return;
    }
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
      active: v,
    }),
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
async function handleIterationsNew(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
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

  let model: FixModel = "default";
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
    if (clientGone) return;
    clientGone = true;
    abortController.abort();
  };
  req.on("close", onClose);

  const writeEvent = (event: object): void => {
    if (clientGone || res.destroyed) return;
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

  // ----- Step 2: invoke the selected fix strategy -----------------------------
  // Claude: SDK reads credentials from env (Console API key or subscription).
  // Cursor CLI: `agent login` or CURSOR_API_KEY. See src/fix/strategies/.
  // eslint-disable-next-line no-console
  console.info(
    `[vite-plugin-comments] dispatching fix (${model}) for comment ${id} on ${found.relativePath}`,
  );

  const agentResult = await runFix({
    projectRoot,
    file: found.relativePath,
    anchor: found.comment.anchor,
    text: found.comment.text,
    screenshot: found.comment.screenshot,
    view: found.comment.view,
    model,
    signal: abortController.signal,
    onEvent: (e) => {
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
        const m = name.match(/^v(\d+)\.tsx$/);
        if (!m) continue;
        const n = Number.parseInt(m[1]!, 10);
        if (Number.isFinite(n) && n > max) max = n;
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
  const v0Png = path.join(iterDir, "v0.png");
  const nextPng = path.join(iterDir, `v${nextV}.png`);

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

  // Best-effort PNG copy. Real re-screenshot of the new visual state is a
  // separate follow-up (would need headless browser or client-side hook).
  try {
    if (existsSync(v0Png)) {
      await copyFile(v0Png, nextPng);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[vite-plugin-comments] failed to copy v0.png → v${nextV}.png: ${err instanceof Error ? err.message : String(err)}`,
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
    const message =
      err instanceof WriteError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    endStream({ type: "done", ok: false, error: message });
    return;
  }

  endStream({
    type: "done",
    ok: true,
    id,
    changed: true,
    v: nextV,
    tsx: `/designs/iterations/${id}/v${nextV}.tsx`,
    png: `/designs/iterations/${id}/v${nextV}.png`,
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
async function handleIterationsScreenshot(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
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
  if (!existsSync(iterDir) || !statSync(iterDir).isDirectory()) {
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

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(
    JSON.stringify({
      ok: true,
      id,
      v,
      png: `/designs/iterations/${id}/v${v}.png`,
    }),
  );
}

type ScreenshotBody = { id: string; v: number; screenshotPng: string };

function parseScreenshotBody(value: unknown):
  | { ok: true; value: ScreenshotBody }
  | { ok: false; reason: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  const id = obj.id;
  const v = obj.v;
  const screenshotPng = obj.screenshotPng;
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, reason: "field `id` must be a non-empty string" };
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    return { ok: false, reason: "field `v` must be a non-negative integer" };
  }
  if (typeof screenshotPng !== "string" || screenshotPng.length === 0) {
    return {
      ok: false,
      reason: "field `screenshotPng` must be a non-empty string",
    };
  }
  return { ok: true, value: { id, v, screenshotPng } };
}

type ActivateBody = { id: string; v: number };

function parseActivateBody(value: unknown):
  | { ok: true; value: ActivateBody }
  | { ok: false; reason: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  const id = obj.id;
  const v = obj.v;
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, reason: "field `id` must be a non-empty string" };
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    return { ok: false, reason: "field `v` must be a non-negative integer" };
  }
  return { ok: true, value: { id, v } };
}

// ---------------------------------------------------------------------------
// Screenshot decoding + atomic writes for iteration artifacts
// ---------------------------------------------------------------------------

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
/** Hard cap on the decoded PNG. 5 MB is plenty for an element-bbox capture. */
const MAX_PNG_BYTES = 5 * 1024 * 1024;
/** First 8 bytes of any PNG. Used as a structural sanity check after decode. */
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Parse a `data:image/png;base64,...` URL, decode it, and apply size + signature
 * guards. Returns null on any mismatch — caller logs a warning and proceeds
 * without a screenshot.
 */
function decodeScreenshotPng(dataUrl: string): Buffer | null {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) return null;
  const payload = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  if (payload.length === 0) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, "base64");
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  if (bytes.length > MAX_PNG_BYTES) return null;
  if (bytes.length < PNG_SIGNATURE.length) return null;
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return null;
  }
  return bytes;
}

async function atomicWriteBytes(
  absolutePath: string,
  bytes: Buffer,
): Promise<void> {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, bytes);
  await rename(tmp, absolutePath);
}

async function atomicWriteText(
  absolutePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, content, "utf8");
  await rename(tmp, absolutePath);
}

// ---------------------------------------------------------------------------
// Request body parsing
// ---------------------------------------------------------------------------

type ReadBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

async function readJsonBody(req: IncomingMessage): Promise<ReadBodyResult> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toString().toLowerCase().includes("application/json")) {
    return { ok: false, reason: "expected content-type: application/json" };
  }
  // 8 MiB ceiling — the body now carries an optional base64-encoded PNG of
  // the targeted element, which can run a few MB for big captures. The PNG
  // itself is bounded to ~5 MB after decode (see screenshot handling below);
  // base64 inflates by ~4/3, plus there's the small JSON envelope, so we
  // give a comfortable upper bound here without leaving the door wide open.
  const MAX_BYTES = 8 * 1024 * 1024;
  return new Promise<ReadBodyResult>((resolve) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        req.removeAllListeners("data");
        req.removeAllListeners("end");
        resolve({ ok: false, reason: "request body too large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const value = raw.length === 0 ? {} : JSON.parse(raw);
        resolve({ ok: true, value });
      } catch (err) {
        resolve({
          ok: false,
          reason: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
    req.on("error", (err) => {
      resolve({ ok: false, reason: `request error: ${err.message}` });
    });
  });
}

type PostBody = {
  file: string;
  line: number;
  column: number;
  text: string;
  author: string;
  existingAnchor?: string;
  /**
   * Optional `data:image/png;base64,...` URL captured client-side by the
   * composer. The server decodes it, saves a `v0.png` baseline under
   * `public/designs/iterations/<comment-id>/`, and stamps the resulting URL
   * onto the `@comment` directive's `screenshot` attribute.
   */
  screenshotPng?: string;
  /** App route (pathname + search + hash) where the comment was created. */
  route?: string;
};

type ParseBodyResult =
  | { ok: true; value: PostBody }
  | { ok: false; reason: string };

type PatchBody =
  | { kind: "text"; text: string }
  | { kind: "reply"; reply: { author: string; text: string } }
  | { kind: "editReply"; replyIndex: number; text: string }
  | { kind: "deleteReply"; replyIndex: number };

type ParsePatchBodyResult =
  | { ok: true; value: PatchBody }
  | { ok: false; reason: string };

function parsePatchBody(value: unknown): ParsePatchBodyResult {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  const hasText = "text" in obj;
  const hasReply = "reply" in obj;
  const hasEditReply = "editReply" in obj;
  const hasDeleteReply = "deleteReply" in obj;
  const fieldCount = [hasText, hasReply, hasEditReply, hasDeleteReply].filter(
    Boolean,
  ).length;

  if (fieldCount !== 1) {
    return {
      ok: false,
      reason:
        "body must include exactly one of `text`, `reply`, `editReply`, or `deleteReply`",
    };
  }

  if (hasText) {
    const text = obj.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return { ok: false, reason: "field `text` must be a non-empty string" };
    }
    return { ok: true, value: { kind: "text", text: text.trim() } };
  }

  if (hasEditReply) {
    const editReply = obj.editReply;
    if (!editReply || typeof editReply !== "object") {
      return { ok: false, reason: "field `editReply` must be an object" };
    }
    const editReplyObj = editReply as Record<string, unknown>;
    const index = editReplyObj.index;
    const text = editReplyObj.text;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return {
        ok: false,
        reason: "field `editReply.index` must be a non-negative integer",
      };
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      return {
        ok: false,
        reason: "field `editReply.text` must be a non-empty string",
      };
    }
    return {
      ok: true,
      value: { kind: "editReply", replyIndex: index, text: text.trim() },
    };
  }

  if (hasDeleteReply) {
    const deleteReply = obj.deleteReply;
    if (!deleteReply || typeof deleteReply !== "object") {
      return { ok: false, reason: "field `deleteReply` must be an object" };
    }
    const index = (deleteReply as Record<string, unknown>).index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return {
        ok: false,
        reason: "field `deleteReply.index` must be a non-negative integer",
      };
    }
    return { ok: true, value: { kind: "deleteReply", replyIndex: index } };
  }

  const reply = obj.reply;
  if (!reply || typeof reply !== "object") {
    return { ok: false, reason: "field `reply` must be an object" };
  }
  const replyObj = reply as Record<string, unknown>;
  const author = replyObj.author;
  const replyText = replyObj.text;
  if (typeof author !== "string" || author.trim().length === 0) {
    return {
      ok: false,
      reason: "field `reply.author` must be a non-empty string",
    };
  }
  if (typeof replyText !== "string" || replyText.trim().length === 0) {
    return {
      ok: false,
      reason: "field `reply.text` must be a non-empty string",
    };
  }
  return {
    ok: true,
    value: {
      kind: "reply",
      reply: { author: author.trim(), text: replyText.trim() },
    },
  };
}

function parsePostBody(value: unknown): ParseBodyResult {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  const file = obj.file;
  const line = obj.line;
  const column = obj.column;
  const text = obj.text;
  const author = obj.author;
  const existingAnchor = obj.existingAnchor;
  const screenshotPng = obj.screenshotPng;
  const route = obj.route;

  if (typeof file !== "string" || file.length === 0) {
    return { ok: false, reason: "field `file` must be a non-empty string" };
  }
  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    return { ok: false, reason: "field `line` must be a positive integer" };
  }
  if (typeof column !== "number" || !Number.isInteger(column) || column < 1) {
    return { ok: false, reason: "field `column` must be a positive integer" };
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, reason: "field `text` must be a non-empty string" };
  }
  if (typeof author !== "string" || author.length === 0) {
    return { ok: false, reason: "field `author` must be a non-empty string" };
  }
  if (existingAnchor !== undefined && typeof existingAnchor !== "string") {
    return { ok: false, reason: "field `existingAnchor` must be a string" };
  }
  if (screenshotPng !== undefined && typeof screenshotPng !== "string") {
    return { ok: false, reason: "field `screenshotPng` must be a string" };
  }
  if (route !== undefined && typeof route !== "string") {
    return { ok: false, reason: "field `route` must be a string" };
  }
  return {
    ok: true,
    value: {
      file,
      line,
      column,
      text,
      author,
      ...(typeof existingAnchor === "string" ? { existingAnchor } : {}),
      ...(typeof screenshotPng === "string" ? { screenshotPng } : {}),
      ...(typeof route === "string" && route.length > 0 ? { route } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

type SafePathResult =
  | { ok: true; absolutePath: string; relativePath: string }
  | { ok: false; reason: string };

/**
 * Accept any `.tsx` under `src/` except configured exclude prefixes.
 * Verify after resolution that the absolute path stays inside `<root>/src/`.
 * Defeats `../` traversal and absolute-path inputs.
 */
function resolveSafePagePath(
  projectRoot: string,
  file: string,
  excludeSrcPrefixes: string[],
): SafePathResult {
  if (path.isAbsolute(file)) {
    return { ok: false, reason: "file must be a relative path" };
  }
  // Normalize separators for cross-platform sanity and check prefix on the
  // posix-style relative path before resolution.
  const normalized = file.split(path.sep).join(path.posix.sep);
  if (!normalized.startsWith(`${SRC_REL}/`)) {
    return { ok: false, reason: `file must be under ${SRC_REL}/` };
  }
  if (!normalized.endsWith(".tsx")) {
    return { ok: false, reason: "file must end in .tsx" };
  }
  for (const excluded of excludeSrcPrefixes) {
    if (normalized.startsWith(excluded)) {
      return {
        ok: false,
        reason: `file is under ${excluded} (excluded via excludeSrcPrefixes)`,
      };
    }
  }

  const srcRootAbs = path.resolve(projectRoot, SRC_REL);
  const candidateAbs = path.resolve(projectRoot, normalized);
  // Containment check — path.resolve collapses `..`, so verify the result is
  // actually inside the src root.
  const rel = path.relative(srcRootAbs, candidateAbs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: "path traversal rejected" };
  }

  return {
    ok: true,
    absolutePath: candidateAbs,
    relativePath: normalized,
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify({ error: message }));
}
