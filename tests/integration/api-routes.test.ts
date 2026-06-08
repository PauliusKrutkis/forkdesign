/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FLOW UNDER TEST: comment + iteration HTTP route handlers, end-to-end
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Drives the REAL request handlers in src/server/api/* against a temp project
 * with the agent STUBBED, asserting both the response shape AND the resulting
 * file-system effects. No Vite, no real HTTP server — the handlers take
 * (req, res, projectRoot, excludeSrcPrefixes[, hooks]) directly.
 *
 * Real handlers under test:
 *   - src/server/api/comments/routes.ts
 *       handleGet(req,res,root,exclude)      — ?file= single page OR bulk scan
 *       handlePost(req,res,root,exclude)     — create comment + seed v0 baseline
 *       handlePatch(req,res,root,exclude)    — text/reply/editReply/deleteReply/resolved
 *       handleDelete(req,res,root,exclude)   — delete marker; ?revert=baseline first
 *   - src/server/api/iterations/routes.ts
 *       handleIterationsList(req,res,root,exclude)     — GET ?id=
 *       handleIterationsActivate(req,res,root,exclude,hooks?)
 *       handleIterationsDelete(req,res,root,exclude,hooks?)
 *       handleIterationsScreenshot(req,res,root,exclude)
 *       handleIterationsNew(req,res,root,exclude,hooks?)  — NDJSON stream; runs
 *         the STUBBED agent via runNewIteration.
 *   - Body parsers: src/server/api/{comments,iterations}/parse-body.ts.
 *
 * HTTP harness (REAL helper — already in the repo):
 *   import { createJsonRequest, createMockResponse } from
 *     "../../src/server/platform/http-test-helpers.ts";
 *     - createJsonRequest(body, { method, url }) → IncomingMessage that emits
 *       the JSON body on next microtask.
 *     - createMockResponse() → { res, getStatus(), getBody(), getJson() }.
 *   NOTE: handlePatch/handleDelete read the id from req.url's pathname
 *     (LEADING_SLASHES_RE strips the leading "/"), so pass url: "/<id>" (and
 *     "?revert=baseline" where needed). handleIterationsList/New read id from
 *     query/body respectively.
 *   NOTE: handleIterationsNew opens an NDJSON stream and writes via res.write —
 *     createMockResponse only implements .end(). EITHER extend the mock with a
 *     `.write` collector in the helper layer, OR call runNewIteration directly
 *     with a hand-rolled NdjsonStream (see iteration-snapshot.test.ts) and test
 *     handleIterationsNew's PRE-stream validation paths (400s) via the mock.
 *
 * Helpers (owned by another agent — ASSUME THEY EXIST):
 *   import { createTempProject, stubAgent } from "../helpers";
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
// TODO: import { createTempProject, stubAgent } from "../helpers";
// TODO: import { createJsonRequest, createMockResponse } from "../../src/server/platform/http-test-helpers.ts";
// TODO: import { handleGet, handlePost, handlePatch, handleDelete } from "../../src/server/api/comments/routes.ts";
// TODO: import {
//         handleIterationsList,
//         handleIterationsActivate,
//         handleIterationsDelete,
//         handleIterationsNew,
//         handleIterationsScreenshot,
//       } from "../../src/server/api/iterations/routes.ts";
// TODO: import { readCommentsFromFile } from "../../src/server/comments/reader.ts";
// TODO: import { resolveIterationDirRoots } from "../../src/server/iterations/manifest.ts";

const EXCLUDE: string[] = []; // excludeSrcPrefixes — empty for the fixture.

describe("integration: comments API routes", () => {
  // let project: Awaited<ReturnType<typeof createTempProject>>;

  beforeEach(async () => {
    // TODO: project = await createTempProject();
  });

  afterEach(async () => {
    // TODO: await project.cleanup();
  });

  // ── POST /api/comments (create) ────────────────────────────────────────────

  describe("POST /api/comments", () => {
    it.todo("happy path: creates marker, seeds v0, returns {id,anchor,...}", async () => {
      // ARRANGE: req = createJsonRequest({ file: "src/<page>.tsx", line, column,
      //   text: "Tighten spacing", author: "paulius.krutkis@oxylabs.io" },
      //   { method: "POST", url: "/" }); res = createMockResponse().
      // ACT: await handlePost(req, res.res, project.root, EXCLUDE).
      // ASSERT (response): res.getStatus() === 200; res.getJson() has a uuid
      //   `id`, a uuid `anchor`, `file` === "src/<page>.tsx", ISO `date`, and
      //   `view` (null or the data-view slug).
      // ASSERT (fs effects): the page now contains the @comment marker (read it
      //   back via readCommentsFromFile → one comment with that id). v0 baseline
      //   was seeded: resolveIterationDirRoots(root, id) is non-empty and
      //   public/designs/iterations/<id>/v0.tsx exists and contains the marker.
    });

    it.todo("malformed body → 400 with the parser's reason, no file mutation", async () => {
      // ACT: POST with missing `text` (or line<1, or non-object body, or
      //   blank `author`). Capture original page bytes first.
      // ASSERT: status 400; body reason matches the relevant parse-body message
      //   (e.g. "field `text` must be a non-empty string"). The page is
      //   byte-for-byte UNCHANGED; NO iteration dir was created.
    });

    it.todo("file not under src/ or missing → 400 / 404 respectively", async () => {
      // ASSERT: file "lib/x.tsx" → 400 (resolveSafePagePath: must be under src/).
      // ASSERT: file "src/does-not-exist.tsx" → 404 "file not found: ...".
    });
  });

  // ── GET /api/comments ──────────────────────────────────────────────────────

  describe("GET /api/comments", () => {
    it.todo("?file= returns the comments for one page", async () => {
      // ARRANGE: create one comment via handlePost.
      // ACT: handleGet with url "/?file=src/<page>.tsx".
      // ASSERT: 200; body { file, comments:[{ id, anchor, text, ... }] }.
    });

    it.todo("no ?file → bulk scan returns comments across all src .tsx files", async () => {
      // ARRANGE: create comments in two different pages.
      // ACT: handleGet with url "/" (no file param).
      // ASSERT: body { comments:[...] } includes BOTH, each tagged with its
      //   `file` relative path.
    });

    it.todo("?file with traversal → 400; existing-but-empty page → comments:[]", async () => {
      // ASSERT: "?file=src/../secret.tsx" → 400 reason from resolveSafePagePath.
      // ASSERT: a page with no markers → 200 { comments: [] }.
    });
  });

  // ── PATCH /api/comments/:id ────────────────────────────────────────────────

  describe("PATCH /api/comments/:id", () => {
    it.todo("text update, reply append, resolved toggle each succeed and persist", async () => {
      // ARRANGE: create a comment → id.
      // ACT 1 (text): PATCH url "/<id>" body { text: "new text" } →
      //   200 { ok:true, id, file, text:"new text" }; reader shows updated text.
      // ACT 2 (reply): PATCH body { reply:{ author, text } } →
      //   200 { ok:true, reply:{ author, date, text, v } }; reader shows the
      //   reply appended with a server-stamped ISO date.
      // ACT 3 (resolved): PATCH body { resolved: true } → 200; reader shows
      //   resolved === true.
    });

    it.todo("malformed PATCH body → 400 (exactly-one-field rule)", async () => {
      // ASSERT: body {} or body with TWO of {text,reply,...} → 400
      //   "body must include exactly one of ...".
      // ASSERT: body { text: "" } → 400 "field `text` must be a non-empty string".
    });

    it.todo("unknown id → 404; unsafe id → 400", async () => {
      // ASSERT: PATCH url "/does-not-exist" body {text:"x"} → 404
      //   "comment id not found".
      // ASSERT: PATCH url "/has spaces" → 400 "comment id contains unsafe path
      //   characters" (isSafePathSegment rejects).
    });
  });

  // ── DELETE /api/comments/:id ───────────────────────────────────────────────

  describe("DELETE /api/comments/:id", () => {
    it.todo("removes the marker and (when last) the anchor; cleans iteration dirs", async () => {
      // ARRANGE: create one comment → id.
      // ACT: handleDelete url "/<id>".
      // ASSERT: 200 { ok:true, id, file, removedAnchor:true, reverted:false };
      //   reader shows zero comments; data-comment-anchor stripped from the
      //   element; designs/ + public/designs/ iteration dirs for <id> removed.
    });

    it.todo("?revert=baseline reverts source before delete (see activate-revert test)", async () => {
      // Cross-reference: the byte-for-byte revert assertions live in
      // activate-revert.test.ts. Here assert only the route contract: with
      // active>0, response.reverted === true; with an invalid revert value
      // (?revert=foo) → 400 'query param `revert` must be "baseline"'.
    });

    it.todo("unknown id → 404; unsafe id → 400", async () => {
      // Same id-validation contract as PATCH.
    });
  });
});

describe("integration: iterations API routes", () => {
  // let project; let agent;

  beforeEach(async () => {
    // TODO: project = await createTempProject(); agent = stubAgent();
    // TODO: COMMON: POST a comment so an id + v0 baseline exist before any
    //       iteration-route call (handlers resolve via resolveCommentIterationContext,
    //       which 404s when the comment OR its iteration dir is missing).
  });

  afterEach(async () => {
    // TODO: await project.cleanup(); agent.restore();
  });

  it.todo("GET /api/iterations?id= lists complete versions with active", async () => {
    // ARRANGE: run one iteration (stubbed) so v1 exists with both tsx+png.
    // ACT: handleIterationsList url "/?id=<id>".
    // ASSERT: 200 { id, file, active, versions:[{ v, tsx, png, summary,
    //   createdAt }, ...] }; versions sorted ascending; only versions with BOTH
    //   v{N}.tsx AND v{N}.png appear (a tsx-only version is omitted).
    // ASSERT: missing id → 400 "missing query param: id"; unsafe id → 400.
    // ASSERT: unknown id → 404 (resolveCommentIterationContext).
  });

  it.todo("POST /api/iterations/activate switches the live source + responds", async () => {
    // ARRANGE: run one iteration → v1 exists.
    // ACT: handleIterationsActivate body { id, v: 0 } (revert to baseline) and
    //   separately { id, v: 1 }.
    // ASSERT: 200 { ok:true, id, file, active:v }; the live page reflects the
    //   chosen version; reader shows marker active === v.
    // ASSERT: { id, v: 99 } (missing snapshot) → 400 "version snapshot not
    //   found: v99.tsx" and live source unchanged.
    // ASSERT: malformed body (missing v, negative v) → 400 from parseActivateBody.
  });

  it.todo("POST /api/iterations/delete removes a version and re-points active", async () => {
    // ARRANGE: run two iterations → v1, v2 (active=2).
    // ACT: handleIterationsDelete body { id, v: 2 }.
    // ASSERT: 200 { ok:true, id, file, deleted:2, active:1 }; v2.tsx/.png gone;
    //   manifest entry "2" removed; live source re-pointed to v1.
    // ASSERT: { id, v: 0 } → 400 (baseline cannot be deleted, parseDeleteVersionBody).
    // ASSERT: deleting a non-existent version → 400 "version v.. not found".
  });

  it.todo("POST /api/iterations/screenshot stores v{N}.png and marks captured", async () => {
    // ARRANGE: have an iteration dir (from baseline seed).
    // ACT: handleIterationsScreenshot body { id, v: 0, screenshotPng:
    //   "data:image/png;base64,<valid tiny png>" }.
    // ASSERT: 200 { ok:true, id, v:0, png:"/designs/iterations/<id>/v0.png?t=..." };
    //   the png bytes are on disk; manifest versions["0"].screenshotCaptured===true.
    // ASSERT: invalid base64 / non-PNG payload → 400 "invalid PNG payload".
    // ASSERT: missing screenshotPng → 400 from parseScreenshotBody.
  });

  describe("POST /api/iterations/new (NDJSON, stubbed agent)", () => {
    it.todo("validation errors return JSON 400 BEFORE the stream opens", async () => {
      // ACT: handleIterationsNew with body missing `id`, or unsafe id, or
      //   count out of [DEFAULT..MAX] range, or unknown model/skill.
      // ASSERT: status 400 with the parse-body reason; NO NDJSON written; the
      //   agent stub was NOT invoked. (createMockResponse suffices here since
      //   no res.write happens on the validation path.)
      // ASSERT: unknown id (valid shape) → 404 from resolveCommentIterationContext.
    });

    it.todo(
      "happy path streams progress then a terminal done event, with snapshots on disk",
      async () => {
        // NOTE: handleIterationsNew uses res.write for NDJSON — either extend
        //   the mock response with a write collector, or (preferred) test the
        //   underlying runNewIteration directly (see iteration-snapshot.test.ts)
        //   and keep this case focused on the route wiring: that the stubbed
        //   agent is dispatched with ctx.found, that a v1.tsx snapshot lands on
        //   disk, and that exactly ONE terminal { type:"done" } event is the
        //   last line written. Assert ok:true and v:1 on that done event.
      }
    );
  });
});
