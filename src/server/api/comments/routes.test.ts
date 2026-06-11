import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readCommentsFromFile } from "../../comments/reader.ts";
import {
  updateCommentActive,
  writeCommentToFile,
} from "../../comments/writer.ts";
import {
  createJsonRequest,
  createMockResponse,
} from "../../platform/http-test-helpers.ts";
import { handleDelete, handleGet, handlePatch, handlePost } from "./routes.ts";

const dir = mkdtempSync(path.join(tmpdir(), "comments-routes-test-"));
const projectRoot = dir;
const relativeFile = "src/pages/Widget.tsx";
const absoluteFile = path.join(projectRoot, relativeFile);

const SOURCE = `export function P() {
  return (
    <div>
      <button>Save</button>
    </div>
  );
}
`;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(path.join(projectRoot, "src"), { recursive: true, force: true });
  rmSync(path.join(projectRoot, "public"), { recursive: true, force: true });
  rmSync(path.join(projectRoot, "designs"), { recursive: true, force: true });
  mkdirSync(path.dirname(absoluteFile), { recursive: true });
  writeFileSync(absoluteFile, SOURCE, "utf8");
});

function seedComment() {
  return writeCommentToFile({
    absolutePath: absoluteFile,
    line: 4,
    column: 7,
    text: "seed comment",
    author: "dev@local",
  });
}

async function seedCommentWithActiveV1() {
  const mock = createMockResponse();
  const req = createJsonRequest({
    file: relativeFile,
    line: 4,
    column: 7,
    text: "seed comment",
    author: "dev@local",
  });
  await handlePost(req, mock.res, projectRoot, []);
  const body = mock.getJson() as { id: string };
  const iterDir = path.join(
    projectRoot,
    "public",
    "designs",
    "iterations",
    body.id
  );
  const v0Source = readFileSync(path.join(iterDir, "v0.tsx"), "utf8");
  const current = readFileSync(absoluteFile, "utf8");
  const v1Source = current.replace("</div>", "{/* v1-edit */}</div>");
  writeFileSync(absoluteFile, v1Source, "utf8");
  writeFileSync(path.join(iterDir, "v1.tsx"), v1Source, "utf8");
  await updateCommentActive({
    absolutePath: absoluteFile,
    commentId: body.id,
    active: 1,
  });
  return { id: body.id, v0Source, v1Source };
}

describe("handlePost", () => {
  it("creates a marker and baseline iteration artifacts", async () => {
    const mock = createMockResponse();
    const req = createJsonRequest({
      file: relativeFile,
      line: 4,
      column: 7,
      text: "too heavy",
      author: "dev@local",
    });

    await handlePost(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(200);
    const body = mock.getJson() as {
      id: string;
      anchor: string;
      file: string;
    };
    expect(body.file).toBe(relativeFile);
    expect(body.id).toBeTruthy();
    expect(body.anchor).toBeTruthy();

    const source = readFileSync(absoluteFile, "utf8");
    expect(source).toContain(`@comment id="${body.id}"`);
    expect(source).toContain(`data-comment-anchor="${body.anchor}"`);

    const baselinePath = path.join(
      projectRoot,
      "public",
      "designs",
      "iterations",
      body.id,
      "v0.tsx"
    );
    expect(existsSync(baselinePath)).toBe(true);
    expect(readFileSync(baselinePath, "utf8")).toContain(
      `@comment id="${body.id}"`
    );
  });

  it("rejects traversal paths with 400", async () => {
    const mock = createMockResponse();
    const req = createJsonRequest({
      file: "src/pages/../../secret.tsx",
      line: 4,
      column: 7,
      text: "nope",
      author: "dev@local",
    });

    await handlePost(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(400);
    expect(mock.getJson()).toEqual({
      error: "path traversal rejected",
    });
  });
});

describe("handleGet", () => {
  it("returns comments for a specific file", async () => {
    const created = await seedComment();
    const mock = createMockResponse();
    const req = createJsonRequest(undefined, {
      method: "GET",
      url: `/?file=${encodeURIComponent(relativeFile)}`,
    });
    req.headers = {};

    await handleGet(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(200);
    const body = mock.getJson() as {
      file: string;
      comments: { id: string }[];
    };
    expect(body.file).toBe(relativeFile);
    expect(body.comments.some((c) => c.id === created.id)).toBe(true);
  });

  it("returns comments across src/ when file param is omitted", async () => {
    const created = await seedComment();
    const mock = createMockResponse();
    const req = createJsonRequest(undefined, {
      method: "GET",
      url: "/",
    });
    req.headers = {};

    await handleGet(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(200);
    const body = mock.getJson() as {
      comments: { id: string; file: string }[];
    };
    expect(body.comments.some((c) => c.id === created.id)).toBe(true);
    expect(body.comments.some((c) => c.file === relativeFile)).toBe(true);
  });
});

describe("handlePatch", () => {
  it("updates comment text by id", async () => {
    const created = await seedComment();
    const mock = createMockResponse();
    const req = createJsonRequest(
      { text: "updated text" },
      { method: "PATCH", url: `/${created.id}` }
    );

    await handlePatch(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(200);
    expect(mock.getJson()).toMatchObject({
      ok: true,
      id: created.id,
      file: relativeFile,
      text: "updated text",
    });

    const { comments } = await readCommentsFromFile(absoluteFile);
    expect(comments.find((c) => c.id === created.id)?.text).toBe(
      "updated text"
    );
  });

  it("appends a reply by id", async () => {
    const created = await seedComment();
    const mock = createMockResponse();
    const req = createJsonRequest(
      { reply: { author: "reviewer@local", text: "please tweak" } },
      { method: "PATCH", url: `/${created.id}` }
    );

    await handlePatch(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(200);
    const body = mock.getJson() as {
      ok: boolean;
      reply: { text: string };
    };
    expect(body.ok).toBe(true);
    expect(body.reply.text).toBe("please tweak");

    const { comments } = await readCommentsFromFile(absoluteFile);
    const comment = comments.find((c) => c.id === created.id);
    expect(comment?.replies).toHaveLength(1);
    expect(comment?.replies?.[0]?.text).toBe("please tweak");
  });

  it("toggles resolved by id", async () => {
    const created = await seedComment();
    const mock = createMockResponse();
    const req = createJsonRequest(
      { resolved: true },
      { method: "PATCH", url: `/${created.id}` }
    );

    await handlePatch(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(200);
    expect(mock.getJson()).toMatchObject({
      ok: true,
      id: created.id,
      resolved: true,
    });

    const { comments } = await readCommentsFromFile(absoluteFile);
    expect(comments.find((c) => c.id === created.id)?.resolved).toBe(true);
  });
});

describe("handleDelete", () => {
  it("removes a comment marker", async () => {
    const created = await seedComment();
    const mock = createMockResponse();
    const req = createJsonRequest(undefined, {
      method: "DELETE",
      url: `/${created.id}`,
    });
    req.headers = {};

    await handleDelete(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(200);
    expect(mock.getJson()).toMatchObject({
      ok: true,
      id: created.id,
      file: relativeFile,
    });

    const { comments } = await readCommentsFromFile(absoluteFile);
    expect(comments.some((c) => c.id === created.id)).toBe(false);
  });

  it("delete without revert keeps active source edits", async () => {
    const { id } = await seedCommentWithActiveV1();
    const mock = createMockResponse();
    const req = createJsonRequest(undefined, {
      method: "DELETE",
      url: `/${id}`,
    });
    req.headers = {};

    await handleDelete(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(200);
    expect(mock.getJson()).toMatchObject({ ok: true, reverted: false });
    const source = readFileSync(absoluteFile, "utf8");
    expect(source).toContain("v1-edit");
    expect(source).not.toContain("@comment");
  });

  it("delete with revert=baseline restores v0 before removing marker", async () => {
    const { id } = await seedCommentWithActiveV1();
    const mock = createMockResponse();
    const req = createJsonRequest(undefined, {
      method: "DELETE",
      url: `/${id}?revert=baseline`,
    });
    req.headers = {};

    await handleDelete(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(200);
    expect(mock.getJson()).toMatchObject({ ok: true, reverted: true });
    const source = readFileSync(absoluteFile, "utf8");
    expect(source).not.toContain("v1-edit");
    expect(source).not.toContain("@comment");
  });

  it("delete with revert=baseline restores auxiliary files", async () => {
    const { id } = await seedCommentWithActiveV1();
    const iterDir = path.join(
      projectRoot,
      "public",
      "designs",
      "iterations",
      id
    );
    const auxRelativeFile = "src/components/Card.tsx";
    const auxAbsoluteFile = path.join(projectRoot, auxRelativeFile);
    const baselineCard = "export const Card = () => <div>baseline</div>;\n";
    const variantCard = "export const Card = () => <div>variant</div>;\n";
    mkdirSync(path.dirname(auxAbsoluteFile), { recursive: true });
    writeFileSync(auxAbsoluteFile, variantCard, "utf8");
    writeFileSync(
      path.join(iterDir, "v0.files.json"),
      `${JSON.stringify({ [auxRelativeFile]: baselineCard }, null, 2)}\n`,
      "utf8"
    );
    writeFileSync(
      path.join(iterDir, "v1.files.json"),
      `${JSON.stringify({ [auxRelativeFile]: variantCard }, null, 2)}\n`,
      "utf8"
    );

    const mock = createMockResponse();
    const req = createJsonRequest(undefined, {
      method: "DELETE",
      url: `/${id}?revert=baseline`,
    });
    req.headers = {};

    await handleDelete(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(200);
    expect(mock.getJson()).toMatchObject({ ok: true, reverted: true });
    expect(readFileSync(auxAbsoluteFile, "utf8")).toBe(baselineCard);
  });

  it("rejects invalid revert query param", async () => {
    const created = await seedComment();
    const mock = createMockResponse();
    const req = createJsonRequest(undefined, {
      method: "DELETE",
      url: `/${created.id}?revert=invalid`,
    });
    req.headers = {};

    await handleDelete(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(400);
  });

  it("returns 404 for unknown id", async () => {
    const mock = createMockResponse();
    const req = createJsonRequest(undefined, {
      method: "DELETE",
      url: "/missing-id",
    });
    req.headers = {};

    await handleDelete(req, mock.res, projectRoot, []);

    expect(mock.getStatus()).toBe(404);
    expect(mock.getJson()).toEqual({
      error: "comment id not found: missing-id",
    });
  });
});
