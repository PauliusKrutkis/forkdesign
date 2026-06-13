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
 * STREAMING APPROACH (handleIterationsNew): approach (b) — a custom mock
 * response object that implements `.write()`/`.end()` and collects the NDJSON
 * chunks, then parses the accumulated buffer into one event per non-empty line.
 * This exercises the FULL route wiring (openNdjsonResponse + createNdjsonStream
 * + runNewIteration) rather than bypassing it via runNewIteration directly.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handleDelete,
  handleGet,
  handlePatch,
  handlePost,
} from "../../src/server/api/comments/routes.ts";
import {
  handleIterationsActivate,
  handleIterationsDelete,
  handleIterationsList,
  handleIterationsNew,
  handleIterationsScreenshot,
} from "../../src/server/api/iterations/routes.ts";
import { readCommentsFromFile } from "../../src/server/comments/reader.ts";
import { resolveIterationDirRoots } from "../../src/server/iterations/manifest.ts";
import {
  createJsonRequest,
  createMockResponse,
} from "../../src/server/platform/http-test-helpers.ts";
import { createTempProject, stubAgent } from "../helpers/index.ts";

const EXCLUDE: string[] = []; // excludeSrcPrefixes — empty for the fixture.

const PAGE = "src/App.tsx";
const AUTHOR = "dev@local";

// A genuine 1×1 PNG (valid signature) for screenshot tests.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

type TempProject = Awaited<ReturnType<typeof createTempProject>>;
type Agent = ReturnType<typeof stubAgent>;

/**
 * Locate the (1-based line, 1-based column of `<`) of the first occurrence of a
 * JSX opening tag in the CURRENT source. Coordinates shift after each write, so
 * we recompute against the live file right before posting a comment.
 */
async function locateTag(
  abs: string,
  tag: string
): Promise<{ line: number; column: number }> {
  const source = await readFile(abs, "utf8");
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const idx = lines[i]?.indexOf(`<${tag}`) ?? -1;
    if (idx >= 0) {
      return { line: i + 1, column: idx + 1 };
    }
  }
  throw new Error(`tag <${tag}> not found in ${abs}`);
}

/** Create a comment via the REAL POST handler; returns the response JSON. */
async function createComment(
  project: TempProject,
  opts: { file?: string; tag?: string; text?: string } = {}
): Promise<{ id: string; anchor: string; file: string; date: string }> {
  const file = opts.file ?? PAGE;
  const tag = opts.tag ?? "h1";
  const { line, column } = await locateTag(project.srcFile(file), tag);
  const req = createJsonRequest(
    {
      file,
      line,
      column,
      text: opts.text ?? "Tighten spacing",
      author: AUTHOR,
    },
    { method: "POST", url: "/" }
  );
  const res = createMockResponse();
  await handlePost(req, res.res, project.root, EXCLUDE);
  if (res.getStatus() !== 200) {
    throw new Error(`createComment: expected 200, got ${res.getStatus()}`);
  }
  return res.getJson() as {
    id: string;
    anchor: string;
    file: string;
    date: string;
  };
}

/**
 * A mock NDJSON-capable ServerResponse: collects every `.write()` chunk plus the
 * final `.end()` chunk and parses the buffer into one event per non-empty line.
 * Used to drive handleIterationsNew end-to-end (approach b).
 */
function createNdjsonMockResponse(): {
  res: ServerResponse;
  getStatus: () => number;
  events: () => Record<string, unknown>[];
  raw: () => string;
} {
  let statusCode = 200;
  const headers: Record<string, string | string[]> = {};
  let buffer = "";

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()] ?? undefined;
    },
    writeHead(code: number) {
      statusCode = code;
      return res;
    },
    flushHeaders() {
      // no-op
    },
    write(chunk: string | Buffer) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      }
    },
  } as unknown as ServerResponse;

  return {
    res,
    getStatus: () => statusCode,
    raw: () => buffer,
    events: () =>
      buffer
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

/** createJsonRequest tuned for the NDJSON endpoint (POST, JSON body). */
function ndjsonRequest(body: unknown): IncomingMessage {
  return createJsonRequest(body, { method: "POST", url: "/" });
}

/** Upload a screenshot for (id, v) via the REAL screenshot route. */
async function uploadScreenshot(
  project: TempProject,
  id: string,
  v: number
): Promise<void> {
  const shotReq = createJsonRequest(
    { id, v, screenshotPng: TINY_PNG_DATA_URL },
    { method: "POST", url: "/" }
  );
  const shotRes = createMockResponse();
  await handleIterationsScreenshot(shotReq, shotRes.res, project.root, EXCLUDE);
}

/** Highest v{N}.tsx present across both iteration roots (-1 if none). */
function maxTsxVersion(project: TempProject, id: string): number {
  const roots = resolveIterationDirRoots(project.root, id);
  let max = -1;
  for (let v = 0; v <= 64; v += 1) {
    if (roots.some((r) => existsSync(`${r}/v${v}.tsx`))) {
      max = v;
    }
  }
  return max;
}

/**
 * Run one stubbed iteration for `id` (producing v{N}) through the REAL
 * iterations-new route. The route blocks each variant until the client uploads
 * that variant's screenshot (waitForVariantScreenshotUpload, 10s timeout), so
 * we upload CONCURRENTLY while the stream is in flight, retrying the expected
 * next version until the run resolves (the screenshot route notifies the
 * waiter). Returns the terminal done event's version.
 */
async function runOneIteration(
  project: TempProject,
  agent: Agent,
  id: string,
  marker: string
): Promise<number> {
  // Derive the variant from the CURRENT on-disk source (which carries the
  // @comment marker) so the marker survives — the real agent edits in place.
  const current = await readFile(project.srcFile(PAGE), "utf8");
  const edited = current.replace(
    "ForkDesign Playground",
    `ForkDesign Playground ${marker}`
  );
  agent.setVariant({ source: edited });
  // The next version this count:1 run will create.
  const expectedV = maxTsxVersion(project, id) + 1;

  const req = ndjsonRequest({ id, count: 1 });
  const res = createNdjsonMockResponse();

  let settled = false;
  const run = handleIterationsNew(req, res.res, project.root, EXCLUDE).finally(
    () => {
      settled = true;
    }
  );

  while (!settled) {
    await uploadScreenshot(project, id, expectedV);
    await new Promise((r) => setTimeout(r, 5));
  }
  await run;

  const events = res.events();
  const done = events.at(-1) as { type: string; ok: boolean; v?: number };
  if (done.type !== "done" || !done.ok) {
    throw new Error(
      `runOneIteration: expected a successful done event, got ${JSON.stringify(done)}`
    );
  }
  const v = done.v as number;
  // Ensure the final version's png is present on disk (complete = tsx + png).
  await uploadScreenshot(project, id, v);
  return v;
}

// Recognizable per-version markers spliced into the live source (which keeps
// its @comment marker) so each iteration is a distinct, marker-preserving edit.
const VARIANT_1 = "v1";
const VARIANT_2 = "v2";

describe("integration: comments API routes", () => {
  let project: TempProject;

  beforeEach(async () => {
    project = await createTempProject();
  });

  afterEach(async () => {
    await project.cleanup();
  });

  // ── POST /api/comments (create) ────────────────────────────────────────────

  describe("POST /api/comments", () => {
    it("happy path: creates marker, seeds v0, returns {id,anchor,...}", async () => {
      const { line, column } = await locateTag(project.srcFile(PAGE), "h1");
      const req = createJsonRequest(
        { file: PAGE, line, column, text: "Tighten spacing", author: AUTHOR },
        { method: "POST", url: "/" }
      );
      const res = createMockResponse();
      await handlePost(req, res.res, project.root, EXCLUDE);

      expect(res.getStatus()).toBe(200);
      const body = res.getJson() as Record<string, unknown>;
      expect(typeof body.id).toBe("string");
      expect((body.id as string).length).toBeGreaterThan(0);
      expect(typeof body.anchor).toBe("string");
      expect(body.file).toBe(PAGE);
      expect(typeof body.date).toBe("string");
      expect(() => new Date(body.date as string).toISOString()).not.toThrow();
      expect(body.view).toBe("playground");

      // fs effect: marker is in the page and readable.
      const { comments } = await readCommentsFromFile(project.srcFile(PAGE));
      expect(comments).toHaveLength(1);
      expect(comments[0].id).toBe(body.id);

      // v0 baseline seeded under public/designs/iterations/<id>/v0.tsx.
      const roots = resolveIterationDirRoots(project.root, body.id as string);
      expect(roots.length).toBeGreaterThan(0);
      const v0Public = await readFile(
        `${project.root}/public/designs/iterations/${body.id}/v0.tsx`,
        "utf8"
      );
      expect(v0Public).toContain("@comment");
    });

    it("malformed body → 400 with the parser's reason, no file mutation", async () => {
      const before = await readFile(project.srcFile(PAGE), "utf8");
      const { line, column } = await locateTag(project.srcFile(PAGE), "h1");
      const req = createJsonRequest(
        { file: PAGE, line, column, author: AUTHOR }, // missing text
        { method: "POST", url: "/" }
      );
      const res = createMockResponse();
      await handlePost(req, res.res, project.root, EXCLUDE);

      expect(res.getStatus()).toBe(400);
      expect((res.getJson() as { error: string }).error).toBe(
        "field `text` must be a non-empty string"
      );
      // page unchanged byte-for-byte.
      expect(await readFile(project.srcFile(PAGE), "utf8")).toBe(before);
      const { comments } = await readCommentsFromFile(project.srcFile(PAGE));
      expect(comments).toHaveLength(0);
    });

    it("file not under src/ → 400; missing file → 404", async () => {
      const outOfTree = createJsonRequest(
        { file: "lib/x.tsx", line: 1, column: 1, text: "x", author: AUTHOR },
        { method: "POST", url: "/" }
      );
      const res1 = createMockResponse();
      await handlePost(outOfTree, res1.res, project.root, EXCLUDE);
      expect(res1.getStatus()).toBe(400);

      const missing = createJsonRequest(
        {
          file: "src/does-not-exist.tsx",
          line: 1,
          column: 1,
          text: "x",
          author: AUTHOR,
        },
        { method: "POST", url: "/" }
      );
      const res2 = createMockResponse();
      await handlePost(missing, res2.res, project.root, EXCLUDE);
      expect(res2.getStatus()).toBe(404);
      expect((res2.getJson() as { error: string }).error).toContain(
        "file not found:"
      );
    });
  });

  // ── GET /api/comments ──────────────────────────────────────────────────────

  describe("GET /api/comments", () => {
    it("?file= returns the comments for one page", async () => {
      const created = await createComment(project);
      const req = createJsonRequest(undefined, {
        method: "GET",
        url: `/?file=${encodeURIComponent(PAGE)}`,
      });
      const res = createMockResponse();
      await handleGet(req, res.res, project.root, EXCLUDE);

      expect(res.getStatus()).toBe(200);
      const body = res.getJson() as {
        file: string;
        comments: Array<{ id: string; anchor: string; text: string }>;
      };
      expect(body.file).toBe(PAGE);
      expect(body.comments).toHaveLength(1);
      expect(body.comments[0].id).toBe(created.id);
      expect(body.comments[0].text).toBe("Tighten spacing");
    });

    it("no ?file → bulk scan returns comments across all src .tsx files", async () => {
      await project.writeSource(
        "src/Other.tsx",
        "export default function Other() {\n  return <section><h2>Other</h2></section>;\n}\n"
      );
      const a = await createComment(project, { file: PAGE, tag: "h1" });
      const b = await createComment(project, {
        file: "src/Other.tsx",
        tag: "h2",
        text: "second",
      });

      const req = createJsonRequest(undefined, { method: "GET", url: "/" });
      const res = createMockResponse();
      await handleGet(req, res.res, project.root, EXCLUDE);

      expect(res.getStatus()).toBe(200);
      const body = res.getJson() as {
        comments: Array<{ id: string; file: string }>;
      };
      const byId = new Map(body.comments.map((c) => [c.id, c.file]));
      expect(byId.get(a.id)).toBe(PAGE);
      expect(byId.get(b.id)).toBe("src/Other.tsx");
    });

    it("?file traversal → 400; existing-but-empty page → comments:[]", async () => {
      const traversal = createJsonRequest(undefined, {
        method: "GET",
        url: `/?file=${encodeURIComponent("src/../secret.tsx")}`,
      });
      const res1 = createMockResponse();
      await handleGet(traversal, res1.res, project.root, EXCLUDE);
      expect(res1.getStatus()).toBe(400);

      const req = createJsonRequest(undefined, {
        method: "GET",
        url: `/?file=${encodeURIComponent(PAGE)}`,
      });
      const res2 = createMockResponse();
      await handleGet(req, res2.res, project.root, EXCLUDE);
      expect(res2.getStatus()).toBe(200);
      expect((res2.getJson() as { comments: unknown[] }).comments).toEqual([]);
    });
  });

  // ── PATCH /api/comments/:id ────────────────────────────────────────────────

  describe("PATCH /api/comments/:id", () => {
    it("text update, reply append, resolved toggle each succeed and persist", async () => {
      const { id } = await createComment(project);

      // text update
      const textReq = createJsonRequest(
        { text: "new text" },
        { method: "PATCH", url: `/${id}` }
      );
      const textRes = createMockResponse();
      await handlePatch(textReq, textRes.res, project.root, EXCLUDE);
      expect(textRes.getStatus()).toBe(200);
      expect(textRes.getJson()).toMatchObject({
        ok: true,
        id,
        file: PAGE,
        text: "new text",
      });
      let read = await readCommentsFromFile(project.srcFile(PAGE));
      expect(read.comments[0].text).toBe("new text");

      // reply append
      const replyReq = createJsonRequest(
        { reply: { author: AUTHOR, text: "looks good" } },
        { method: "PATCH", url: `/${id}` }
      );
      const replyRes = createMockResponse();
      await handlePatch(replyReq, replyRes.res, project.root, EXCLUDE);
      expect(replyRes.getStatus()).toBe(200);
      const replyBody = replyRes.getJson() as {
        ok: boolean;
        reply: { author: string; text: string; date: string };
      };
      expect(replyBody.ok).toBe(true);
      expect(replyBody.reply.author).toBe(AUTHOR);
      expect(replyBody.reply.text).toBe("looks good");
      expect(typeof replyBody.reply.date).toBe("string");
      expect(() => new Date(replyBody.reply.date).toISOString()).not.toThrow();
      read = await readCommentsFromFile(project.srcFile(PAGE));
      expect(read.comments[0].replies?.[0]?.text).toBe("looks good");

      // resolved toggle
      const resolvedReq = createJsonRequest(
        { resolved: true },
        { method: "PATCH", url: `/${id}` }
      );
      const resolvedRes = createMockResponse();
      await handlePatch(resolvedReq, resolvedRes.res, project.root, EXCLUDE);
      expect(resolvedRes.getStatus()).toBe(200);
      read = await readCommentsFromFile(project.srcFile(PAGE));
      expect(read.comments[0].resolved).toBe(true);
    });

    it("malformed PATCH body → 400 (exactly-one-field rule)", async () => {
      const { id } = await createComment(project);

      const emptyReq = createJsonRequest(
        {},
        { method: "PATCH", url: `/${id}` }
      );
      const emptyRes = createMockResponse();
      await handlePatch(emptyReq, emptyRes.res, project.root, EXCLUDE);
      expect(emptyRes.getStatus()).toBe(400);
      expect((emptyRes.getJson() as { error: string }).error).toContain(
        "exactly one of"
      );

      const twoReq = createJsonRequest(
        { text: "a", resolved: true },
        { method: "PATCH", url: `/${id}` }
      );
      const twoRes = createMockResponse();
      await handlePatch(twoReq, twoRes.res, project.root, EXCLUDE);
      expect(twoRes.getStatus()).toBe(400);

      const blankTextReq = createJsonRequest(
        { text: "" },
        { method: "PATCH", url: `/${id}` }
      );
      const blankTextRes = createMockResponse();
      await handlePatch(blankTextReq, blankTextRes.res, project.root, EXCLUDE);
      expect(blankTextRes.getStatus()).toBe(400);
      expect((blankTextRes.getJson() as { error: string }).error).toBe(
        "field `text` must be a non-empty string"
      );
    });

    it("unknown id → 404; unsafe id → 400", async () => {
      const unknownReq = createJsonRequest(
        { text: "x" },
        { method: "PATCH", url: "/does-not-exist" }
      );
      const unknownRes = createMockResponse();
      await handlePatch(unknownReq, unknownRes.res, project.root, EXCLUDE);
      expect(unknownRes.getStatus()).toBe(404);
      expect((unknownRes.getJson() as { error: string }).error).toContain(
        "comment id not found"
      );

      const unsafeReq = createJsonRequest(
        { text: "x" },
        { method: "PATCH", url: `/${encodeURIComponent("has spaces")}` }
      );
      const unsafeRes = createMockResponse();
      await handlePatch(unsafeReq, unsafeRes.res, project.root, EXCLUDE);
      expect(unsafeRes.getStatus()).toBe(400);
      expect((unsafeRes.getJson() as { error: string }).error).toContain(
        "unsafe path characters"
      );
    });
  });

  // ── DELETE /api/comments/:id ───────────────────────────────────────────────

  describe("DELETE /api/comments/:id", () => {
    it("removes the marker and the anchor; cleans iteration dirs", async () => {
      const { id } = await createComment(project);
      expect(
        existsSync(`${project.root}/public/designs/iterations/${id}`)
      ).toBe(true);

      const req = createJsonRequest(undefined, {
        method: "DELETE",
        url: `/${id}`,
      });
      const res = createMockResponse();
      await handleDelete(req, res.res, project.root, EXCLUDE);

      expect(res.getStatus()).toBe(200);
      expect(res.getJson()).toMatchObject({
        ok: true,
        id,
        file: PAGE,
        removedAnchor: true,
        reverted: false,
      });

      const { comments } = await readCommentsFromFile(project.srcFile(PAGE));
      expect(comments).toHaveLength(0);
      const source = await readFile(project.srcFile(PAGE), "utf8");
      // The fixture's doc comment mentions `data-comment-anchor` in prose, so
      // assert on the ATTRIBUTE form (with `=`) which only the writer emits.
      expect(source).not.toContain("data-comment-anchor=");

      expect(
        existsSync(`${project.root}/public/designs/iterations/${id}`)
      ).toBe(false);
      expect(existsSync(`${project.root}/designs/iterations/${id}`)).toBe(
        false
      );
    });

    it("invalid ?revert value → 400", async () => {
      const { id } = await createComment(project);
      const req = createJsonRequest(undefined, {
        method: "DELETE",
        url: `/${id}?revert=foo`,
      });
      const res = createMockResponse();
      await handleDelete(req, res.res, project.root, EXCLUDE);
      expect(res.getStatus()).toBe(400);
      expect((res.getJson() as { error: string }).error).toContain(
        'query param `revert` must be "baseline"'
      );
    });

    it("?revert=baseline reverts source before delete (byte-for-byte to baseline) and returns reverted:true", async () => {
      const agent = stubAgent();
      try {
        const { id } = await createComment(project);
        const baseline = await readFile(project.srcFile(PAGE), "utf8");
        await runOneIteration(project, agent, id, VARIANT_1);

        // active is now 1 and live source diverged from baseline.
        const afterIterate = await readFile(project.srcFile(PAGE), "utf8");
        expect(afterIterate).not.toBe(baseline);

        const req = createJsonRequest(undefined, {
          method: "DELETE",
          url: `/${id}?revert=baseline`,
        });
        const res = createMockResponse();
        await handleDelete(req, res.res, project.root, EXCLUDE);
        expect(res.getStatus()).toBe(200);
        expect(res.getJson()).toMatchObject({ ok: true, id, reverted: true });
      } finally {
        agent.restore();
      }
    });

    it("unknown id → 404; unsafe id → 400", async () => {
      const unknownReq = createJsonRequest(undefined, {
        method: "DELETE",
        url: "/does-not-exist",
      });
      const unknownRes = createMockResponse();
      await handleDelete(unknownReq, unknownRes.res, project.root, EXCLUDE);
      expect(unknownRes.getStatus()).toBe(404);

      const unsafeReq = createJsonRequest(undefined, {
        method: "DELETE",
        url: `/${encodeURIComponent("has spaces")}`,
      });
      const unsafeRes = createMockResponse();
      await handleDelete(unsafeReq, unsafeRes.res, project.root, EXCLUDE);
      expect(unsafeRes.getStatus()).toBe(400);
    });
  });
});

describe("integration: iterations API routes", () => {
  let project: TempProject;
  let agent: Agent;
  let id: string;

  beforeEach(async () => {
    project = await createTempProject();
    agent = stubAgent();
    // POST a comment so an id + v0 baseline exist before any iteration call.
    const created = await createComment(project);
    id = created.id;
  });

  afterEach(async () => {
    await project.cleanup();
    agent.restore();
  });

  it("GET /api/iterations?id= lists complete versions with active", async () => {
    await runOneIteration(project, agent, id, VARIANT_1);

    const req = createJsonRequest(undefined, {
      method: "GET",
      url: `/?id=${id}`,
    });
    const res = createMockResponse();
    await handleIterationsList(req, res.res, project.root, EXCLUDE);

    expect(res.getStatus()).toBe(200);
    const body = res.getJson() as {
      id: string;
      file: string;
      active: number;
      versions: Array<{ v: number; tsx: string; png: string }>;
    };
    expect(body.id).toBe(id);
    expect(body.file).toBe(PAGE);
    expect(body.active).toBe(1);
    const vs = body.versions.map((x) => x.v);
    expect(vs).toContain(1);
    expect([...vs].sort((a, b) => a - b)).toEqual(vs); // ascending
    expect(body.versions.find((x) => x.v === 1)?.tsx).toBe(
      `/designs/iterations/${id}/v1.tsx`
    );

    // missing id → 400
    const missing = createJsonRequest(undefined, { method: "GET", url: "/" });
    const missingRes = createMockResponse();
    await handleIterationsList(missing, missingRes.res, project.root, EXCLUDE);
    expect(missingRes.getStatus()).toBe(400);
    expect((missingRes.getJson() as { error: string }).error).toBe(
      "missing query param: id"
    );

    // unsafe id → 400
    const unsafe = createJsonRequest(undefined, {
      method: "GET",
      url: `/?id=${encodeURIComponent("a/b")}`,
    });
    const unsafeRes = createMockResponse();
    await handleIterationsList(unsafe, unsafeRes.res, project.root, EXCLUDE);
    expect(unsafeRes.getStatus()).toBe(400);

    // unknown id (valid shape) → 404
    const unknown = createJsonRequest(undefined, {
      method: "GET",
      url: "/?id=00000000-0000-0000-0000-000000000000",
    });
    const unknownRes = createMockResponse();
    await handleIterationsList(unknown, unknownRes.res, project.root, EXCLUDE);
    expect(unknownRes.getStatus()).toBe(404);
  });

  it("POST /api/iterations/activate switches the live source + responds", async () => {
    await runOneIteration(project, agent, id, VARIANT_1);

    // activate v1
    const toV1 = createJsonRequest({ id, v: 1 }, { method: "POST", url: "/" });
    const toV1Res = createMockResponse();
    await handleIterationsActivate(toV1, toV1Res.res, project.root, EXCLUDE);
    expect(toV1Res.getStatus()).toBe(200);
    expect(toV1Res.getJson()).toMatchObject({
      ok: true,
      id,
      file: PAGE,
      active: 1,
    });
    let read = await readCommentsFromFile(project.srcFile(PAGE));
    expect(read.comments[0].active).toBe(1);
    expect(await readFile(project.srcFile(PAGE), "utf8")).toContain(
      "ForkDesign Playground v1"
    );

    // activate v0 (back to baseline)
    const toV0 = createJsonRequest({ id, v: 0 }, { method: "POST", url: "/" });
    const toV0Res = createMockResponse();
    await handleIterationsActivate(toV0, toV0Res.res, project.root, EXCLUDE);
    expect(toV0Res.getStatus()).toBe(200);
    expect((toV0Res.getJson() as { active: number }).active).toBe(0);
    read = await readCommentsFromFile(project.srcFile(PAGE));
    expect(read.comments[0].active ?? 0).toBe(0);

    // missing snapshot → 400
    const v99 = createJsonRequest({ id, v: 99 }, { method: "POST", url: "/" });
    const v99Res = createMockResponse();
    await handleIterationsActivate(v99, v99Res.res, project.root, EXCLUDE);
    expect(v99Res.getStatus()).toBe(400);
    expect((v99Res.getJson() as { error: string }).error).toContain("v99.tsx");

    // malformed body (missing v) → 400
    const noV = createJsonRequest({ id }, { method: "POST", url: "/" });
    const noVRes = createMockResponse();
    await handleIterationsActivate(noV, noVRes.res, project.root, EXCLUDE);
    expect(noVRes.getStatus()).toBe(400);

    // negative v → 400
    const negV = createJsonRequest({ id, v: -1 }, { method: "POST", url: "/" });
    const negVRes = createMockResponse();
    await handleIterationsActivate(negV, negVRes.res, project.root, EXCLUDE);
    expect(negVRes.getStatus()).toBe(400);
  });

  it("POST /api/iterations/delete removes a version and re-points active", async () => {
    await runOneIteration(project, agent, id, VARIANT_1);
    await runOneIteration(project, agent, id, VARIANT_2);
    let read = await readCommentsFromFile(project.srcFile(PAGE));
    expect(read.comments[0].active).toBe(2);

    const del = createJsonRequest({ id, v: 2 }, { method: "POST", url: "/" });
    const delRes = createMockResponse();
    await handleIterationsDelete(del, delRes.res, project.root, EXCLUDE);
    expect(delRes.getStatus()).toBe(200);
    expect(delRes.getJson()).toMatchObject({
      ok: true,
      id,
      file: PAGE,
      deleted: 2,
      active: 1,
    });
    expect(existsSync(`${project.root}/designs/iterations/${id}/v2.tsx`)).toBe(
      false
    );
    read = await readCommentsFromFile(project.srcFile(PAGE));
    expect(read.comments[0].active).toBe(1);

    // v0 → 400 (baseline cannot be deleted)
    const delV0 = createJsonRequest({ id, v: 0 }, { method: "POST", url: "/" });
    const delV0Res = createMockResponse();
    await handleIterationsDelete(delV0, delV0Res.res, project.root, EXCLUDE);
    expect(delV0Res.getStatus()).toBe(400);

    // deleting non-existent version → 400 "version v5 not found"
    const delMissing = createJsonRequest(
      { id, v: 5 },
      { method: "POST", url: "/" }
    );
    const delMissingRes = createMockResponse();
    await handleIterationsDelete(
      delMissing,
      delMissingRes.res,
      project.root,
      EXCLUDE
    );
    expect(delMissingRes.getStatus()).toBe(400);
    expect((delMissingRes.getJson() as { error: string }).error).toContain(
      "version v5 not found"
    );
  });

  it("POST /api/iterations/screenshot stores v{N}.png and marks captured", async () => {
    const req = createJsonRequest(
      { id, v: 0, screenshotPng: TINY_PNG_DATA_URL },
      { method: "POST", url: "/" }
    );
    const res = createMockResponse();
    await handleIterationsScreenshot(req, res.res, project.root, EXCLUDE);

    expect(res.getStatus()).toBe(200);
    const body = res.getJson() as {
      ok: boolean;
      id: string;
      v: number;
      png: string;
    };
    expect(body.ok).toBe(true);
    expect(body.id).toBe(id);
    expect(body.v).toBe(0);
    expect(body.png).toContain(`/designs/iterations/${id}/v0.png`);

    // png bytes on disk (v0's iterDir is under public/designs).
    const roots = resolveIterationDirRoots(project.root, id);
    const found = roots.map((r) => `${r}/v0.png`).find((p) => existsSync(p));
    expect(found).toBeTruthy();

    // invalid PNG payload → 400
    const badReq = createJsonRequest(
      { id, v: 0, screenshotPng: "data:image/png;base64,bm90LWEtcG5n" },
      { method: "POST", url: "/" }
    );
    const badRes = createMockResponse();
    await handleIterationsScreenshot(badReq, badRes.res, project.root, EXCLUDE);
    expect(badRes.getStatus()).toBe(400);
    expect((badRes.getJson() as { error: string }).error).toBe(
      "invalid PNG payload"
    );

    // missing screenshotPng → 400 from parseScreenshotBody
    const missingReq = createJsonRequest(
      { id, v: 0 },
      { method: "POST", url: "/" }
    );
    const missingRes = createMockResponse();
    await handleIterationsScreenshot(
      missingReq,
      missingRes.res,
      project.root,
      EXCLUDE
    );
    expect(missingRes.getStatus()).toBe(400);
  });

  describe("POST /api/iterations/new (NDJSON, stubbed agent)", () => {
    it("validation errors return JSON 400 BEFORE the stream opens", async () => {
      // missing id
      const noId = createJsonRequest(
        { count: 1 },
        { method: "POST", url: "/" }
      );
      const noIdRes = createMockResponse();
      await handleIterationsNew(noId, noIdRes.res, project.root, EXCLUDE);
      expect(noIdRes.getStatus()).toBe(400);

      // unsafe id
      const unsafe = createJsonRequest(
        { id: "a/b" },
        { method: "POST", url: "/" }
      );
      const unsafeRes = createMockResponse();
      await handleIterationsNew(unsafe, unsafeRes.res, project.root, EXCLUDE);
      expect(unsafeRes.getStatus()).toBe(400);

      // count out of range
      const badCount = createJsonRequest(
        { id, count: 9999 },
        { method: "POST", url: "/" }
      );
      const badCountRes = createMockResponse();
      await handleIterationsNew(
        badCount,
        badCountRes.res,
        project.root,
        EXCLUDE
      );
      expect(badCountRes.getStatus()).toBe(400);

      // unknown model
      const badModel = createJsonRequest(
        { id, model: "not-a-model" },
        { method: "POST", url: "/" }
      );
      const badModelRes = createMockResponse();
      await handleIterationsNew(
        badModel,
        badModelRes.res,
        project.root,
        EXCLUDE
      );
      expect(badModelRes.getStatus()).toBe(400);

      // no validation path should have dispatched the agent.
      expect(agent.calls).toHaveLength(0);

      // unknown id (valid shape) → 404
      const unknown = createJsonRequest(
        { id: "00000000-0000-0000-0000-000000000000" },
        { method: "POST", url: "/" }
      );
      const unknownRes = createMockResponse();
      await handleIterationsNew(unknown, unknownRes.res, project.root, EXCLUDE);
      expect(unknownRes.getStatus()).toBe(404);
      expect(agent.calls).toHaveLength(0);
    });

    it("happy path streams progress then a terminal done event, with snapshots on disk", async () => {
      // Marker-preserving in-place edit (the real agent edits the live file).
      const current = await readFile(project.srcFile(PAGE), "utf8");
      agent.setVariant({
        source: current.replace(
          "ForkDesign Playground",
          `ForkDesign Playground ${VARIANT_1}`
        ),
      });
      const expectedV = maxTsxVersion(project, id) + 1;
      const req = ndjsonRequest({ id, count: 1 });
      const res = createNdjsonMockResponse();

      // The route blocks the variant on a client screenshot upload; drive it
      // concurrently (same mechanism the real browser client uses).
      let settled = false;
      const run = handleIterationsNew(
        req,
        res.res,
        project.root,
        EXCLUDE
      ).finally(() => {
        settled = true;
      });
      while (!settled) {
        await uploadScreenshot(project, id, expectedV);
        await new Promise((r) => setTimeout(r, 5));
      }
      await run;

      const events = res.events();
      expect(events.length).toBeGreaterThan(0);

      // exactly one terminal done event, and it is the LAST line.
      const doneEvents = events.filter((e) => e.type === "done");
      expect(doneEvents).toHaveLength(1);
      expect(events.at(-1)).toBe(doneEvents[0]);

      const done = doneEvents[0] as { ok: boolean; v: number; id: string };
      expect(done.ok).toBe(true);
      expect(done.v).toBe(1);
      expect(done.id).toBe(id);

      // the stubbed agent was dispatched against ctx.found.
      expect(agent.calls).toHaveLength(1);
      expect(agent.calls[0].file).toBe(PAGE);

      // v1.tsx snapshot lands on disk under designs/iterations/<id>/.
      const v1 = await project.readSnapshot(`iterations/${id}/v1.tsx`);
      expect(v1).toContain("ForkDesign Playground v1");
    });
  });
});
