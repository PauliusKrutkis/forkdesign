/**
 * AST writer for inserting `{/* @comment ... *\/}` markers into a `.tsx` page
 * file.
 *
 * Used by the dev-only Vite plugin (`server/plugins/comments.ts`) to serve the
 * `POST /api/comments` write path. Formatting-preserving via `recast` so we
 * don't churn unrelated regions of the file each time a comment is added.
 *
 * Orchestration lives here; implementation is split across:
 *   - `writer-errors.ts` — WriteError
 *   - `writer-ast.ts` — recast/JSX helpers
 *   - `writer-directive.ts` — string-level @comment directive mutations
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse as parseBabel } from "@babel/parser";
import type * as t from "@babel/types";
import recast from "recast";
import babelTsParser from "recast/parsers/babel-ts.js";
import {
  addAttribute,
  buildCommentMarker,
  findJsxElementAt,
  insertAfterSibling,
  isJsxParent,
  pushComments,
  readAttrValue,
  stripAnchorAttribute,
} from "./writer-ast.ts";
import {
  appendReplyOnDirective,
  atomicWrite,
  deleteReplyOnDirective,
  mutateCommentDirectiveById,
  readActiveFromDirective,
  setActiveOnDirective,
  setTextOnDirective,
  updateReplyOnDirective,
} from "./writer-directive.ts";
import { WriteError } from "./writer-errors.ts";

const COMMENT_ID_ATTR_RE = /\bid="([^"]+)"/;
const ANCHOR_ATTR_RE = /\banchor="([^"]+)"/;
const TRAILING_NEWLINE_INDENT_RE = /\n[ \t]*$/;

export interface WriteCommentInput {
  /** Absolute path to the .tsx file. */
  absolutePath: string;
  /** Author identifier (email). */
  author: string;
  /** 1-indexed column of the `<` of the target JSXElement. */
  column: number;
  /**
   * If the target element already has `data-comment-anchor`, the caller may
   * pass it through so we don't mint a new uuid. When omitted, an existing
   * attribute on the AST is reused as the anchor, otherwise a fresh uuid is
   * minted and added.
   */
  existingAnchor?: string;
  /**
   * Optional pre-allocated uuid to stamp as the directive's `id`. Callers use
   * this when they need the id BEFORE the write (e.g. to compute a screenshot
   * path under `/designs/iterations/<id>/v0.png`). When omitted the writer
   * mints a fresh uuid as before.
   */
  id?: string;
  /** 1-indexed line of the target JSXElement (Babel-style loc.start.line). */
  line: number;
  /**
   * Optional app route (pathname + search + hash) stamped on the directive so
   * the overlay can navigate back to the page where the comment was created.
   */
  route?: string;
  /**
   * Optional repo-root absolute path to the cropped PNG saved at comment time
   * (e.g. `/designs/iterations/<id>/v0.png`). When provided, the writer emits
   * `screenshot="..."` on the directive so the reader can surface it.
   */
  screenshot?: string;
  /** Body text from the composer. */
  text: string;
}

export interface WriteCommentResult {
  /** uuid written as `anchor="..."` and as `data-comment-anchor` on the target. */
  anchor: string;
  /** ISO 8601 date string written as `date="..."`. */
  date: string;
  /** uuid v4 written as the directive's `id="..."`. */
  id: string;
}

/**
 * Mutate the file at `absolutePath` to (a) stamp `data-comment-anchor` on the
 * JSXElement at (line, column) if it doesn't already have one and (b) insert
 * a sibling `{/* @comment ... *\/}` marker. Returns the ids that ended up on
 * disk.
 *
 * Throws on parse errors, no element at (line, column), or invalid output.
 * The on-disk write is atomic-ish: we write to a tmp file in the same
 * directory and rename over the original.
 */
export async function writeCommentToFile(
  input: WriteCommentInput
): Promise<WriteCommentResult> {
  const source = await readFile(input.absolutePath, "utf8");
  const ast = recast.parse(source, { parser: babelTsParser });

  const target = findJsxElementAt(ast, input.line, input.column);
  if (!target) {
    throw new WriteError(
      `no JSXElement found at line:column ${input.line}:${input.column}`,
      400
    );
  }

  // 1. Resolve the anchor uuid. Reuse an existing data-comment-anchor when
  //    present (callers may also pass `existingAnchor` to be explicit).
  const existingAnchorOnNode = readAttrValue(
    target.openingElement,
    "data-comment-anchor"
  );
  const anchorUuid =
    existingAnchorOnNode ?? input.existingAnchor ?? randomUUID();
  if (!existingAnchorOnNode) {
    addAttribute(target.openingElement, "data-comment-anchor", anchorUuid);
  }

  // 2. Mint a fresh id for the comment marker (unless the caller already
  //    allocated one — used by the POST handler when the id is needed up
  //    front to derive paths like `/designs/iterations/<id>/v0.png`).
  const id = input.id ?? randomUUID();
  const date = new Date().toISOString();

  // 3. Build the new JSXExpressionContainer carrying the @comment directive
  //    and insert as next sibling.
  const marker = buildCommentMarker({
    id,
    anchor: anchorUuid,
    text: input.text,
    author: input.author,
    date,
    screenshot: input.screenshot,
    route: input.route,
  });
  insertAfterSibling(ast, target, marker);

  // 4. Serialize, verify, write atomically.
  const output = recast.print(ast).code;
  // Parse the result with the same parser settings the reader uses, so we
  // never persist syntactically-broken output.
  try {
    parseBabel(output, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WriteError(
      `generated output failed to re-parse: ${message}`,
      500
    );
  }

  await atomicWrite(input.absolutePath, output);

  return { id, anchor: anchorUuid, date };
}

export interface UpdateCommentActiveInput {
  /** Absolute path to the .tsx file containing the marker. */
  absolutePath: string;
  /** New value for the directive's `active=N` attribute. */
  active: number;
  /** uuid that matches the `id` attribute on the `@comment` directive. */
  commentId: string;
}

/**
 * Find the `{/* @comment id="<commentId>" ... *\/}` block in `absolutePath` and
 * set its `active=N` attribute to the supplied integer.
 *
 * Mutation strategy: the directive is a free-form attribute list living
 * INSIDE a CommentBlock value (not real AST). We mutate the CommentBlock
 * node's `.value` string and let recast print the surrounding code untouched.
 * Regex-based replace is sufficient because the format is constrained (we
 * emit it ourselves) — we just need to:
 *   1. Replace an existing `active=N` if present.
 *   2. Otherwise append ` active=N` before the trailing whitespace of the
 *      directive (no trailing-newline weirdness since recast preserves block
 *      boundaries).
 *
 * Throws (with status 404) when no matching comment id is found in the file.
 */
export async function updateCommentActive(
  input: UpdateCommentActiveInput
): Promise<void> {
  if (!Number.isInteger(input.active) || input.active < 0) {
    throw new WriteError(
      `active must be a non-negative integer (got ${input.active})`,
      400
    );
  }
  await mutateCommentDirectiveById(
    input.absolutePath,
    input.commentId,
    (raw) => setActiveOnDirective(raw, input.active),
    "updateCommentActive"
  );
}

export interface UpdateCommentTextInput {
  /** Absolute path to the .tsx file containing the marker. */
  absolutePath: string;
  /** uuid that matches the `id` attribute on the `@comment` directive. */
  commentId: string;
  /** New body text for the comment. */
  text: string;
}

/**
 * Find the `{/* @comment id="<commentId>" ... *\/}` block and replace its
 * `text=...` attribute. Uses `JSON.stringify` for the value so the encoding
 * matches `buildCommentMarker`.
 */
export async function updateCommentText(
  input: UpdateCommentTextInput
): Promise<void> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new WriteError("text must be non-empty", 400);
  }
  await mutateCommentDirectiveById(
    input.absolutePath,
    input.commentId,
    (raw) => setTextOnDirective(raw, text),
    "updateCommentText"
  );
}

export interface AppendCommentReplyInput {
  /** Absolute path to the .tsx file containing the marker. */
  absolutePath: string;
  /** uuid that matches the `id` attribute on the `@comment` directive. */
  commentId: string;
  reply: {
    author: string;
    text: string;
    /** 0-based iteration version; defaults to marker `active` when omitted. */
    v?: number;
  };
}

export interface AppendCommentReplyResult {
  author: string;
  date: string;
  text: string;
  v: number;
}

/**
 * Append a flat reply to the `@comment` marker's `replies=[...]` array.
 * Creates the attribute when missing. The server stamps `date` as ISO 8601.
 */
export async function appendCommentReply(
  input: AppendCommentReplyInput
): Promise<AppendCommentReplyResult> {
  const author = input.reply.author.trim();
  const text = input.reply.text.trim();
  if (author.length === 0) {
    throw new WriteError("reply author must be non-empty", 400);
  }
  if (text.length === 0) {
    throw new WriteError("reply text must be non-empty", 400);
  }
  if (
    input.reply.v !== undefined &&
    (!Number.isInteger(input.reply.v) || input.reply.v < 0)
  ) {
    throw new WriteError("reply v must be a non-negative integer", 400);
  }
  const date = new Date().toISOString();
  let stampedV = input.reply.v ?? 0;
  await mutateCommentDirectiveById(
    input.absolutePath,
    input.commentId,
    (raw) => {
      stampedV = input.reply.v ?? readActiveFromDirective(raw);
      return appendReplyOnDirective(raw, {
        author,
        date,
        text,
        v: stampedV,
      });
    },
    "appendCommentReply"
  );
  return { author, date, text, v: stampedV };
}

export interface UpdateCommentReplyInput {
  absolutePath: string;
  commentId: string;
  /** 0-based index into the marker's `replies=[...]` array. */
  replyIndex: number;
  text: string;
}

/**
 * Replace the `text` field on an existing flat reply. Author and date are
 * preserved.
 */
export async function updateCommentReply(
  input: UpdateCommentReplyInput
): Promise<void> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new WriteError("text must be non-empty", 400);
  }
  if (!Number.isInteger(input.replyIndex) || input.replyIndex < 0) {
    throw new WriteError("replyIndex must be a non-negative integer", 400);
  }
  await mutateCommentDirectiveById(
    input.absolutePath,
    input.commentId,
    (raw) => updateReplyOnDirective(raw, input.replyIndex, text),
    "updateCommentReply"
  );
}

export interface DeleteCommentReplyInput {
  absolutePath: string;
  commentId: string;
  /** 0-based index into the marker's `replies=[...]` array. */
  replyIndex: number;
}

/** Remove one flat reply from the marker's `replies=[...]` array. */
export async function deleteCommentReply(
  input: DeleteCommentReplyInput
): Promise<void> {
  if (!Number.isInteger(input.replyIndex) || input.replyIndex < 0) {
    throw new WriteError("replyIndex must be a non-negative integer", 400);
  }
  await mutateCommentDirectiveById(
    input.absolutePath,
    input.commentId,
    (raw) => deleteReplyOnDirective(raw, input.replyIndex),
    "deleteCommentReply"
  );
}

export interface DeleteCommentMarkerInput {
  /** Absolute path to the .tsx file containing the marker. */
  absolutePath: string;
  /** uuid matching the `id` attribute on the `@comment` directive. */
  commentId: string;
}

export interface DeleteCommentMarkerResult {
  /**
   * True when the target was the last @comment block referencing the anchor
   * and we therefore also stripped `data-comment-anchor="<anchor>"` from the
   * JSXElement that carried it. False when other sibling @comment markers
   * still reference the anchor and the attribute was preserved.
   */
  removedAnchor: boolean;
}

interface CommentContainerMatch {
  anchor: string | null;
  container: t.JSXExpressionContainer;
  index: number;
  parent: { children: t.Node[] };
}

function collectCommentBlocks(node: t.JSXExpressionContainer): t.Comment[] {
  const blocks: t.Comment[] = [];
  if (node.expression.type !== "JSXEmptyExpression") {
    return blocks;
  }
  pushComments(node.expression.innerComments, blocks);
  pushComments(node.expression.leadingComments, blocks);
  pushComments(node.expression.trailingComments, blocks);
  return blocks;
}

/** `undefined` when the block is not a matching `@comment` directive. */
function anchorFromCommentBlock(
  block: t.Comment,
  commentId: string
): string | null | undefined {
  if (block.type !== "CommentBlock") {
    return;
  }
  const trimmed = block.value.trim();
  if (!trimmed.startsWith("@comment")) {
    return;
  }
  const idMatch = block.value.match(COMMENT_ID_ATTR_RE);
  if (!idMatch || idMatch[1] !== commentId) {
    return;
  }
  const anchorMatch = block.value.match(ANCHOR_ATTR_RE);
  return anchorMatch ? (anchorMatch[1] ?? null) : null;
}

interface RecastParentPath {
  parent?: RecastParentPath;
  value: unknown;
}

function locateCommentContainerParent(
  node: t.JSXExpressionContainer,
  parentPath: RecastParentPath | null | undefined,
  anchor: string | null
): CommentContainerMatch | null {
  let current = parentPath;
  while (current) {
    const v = current.value;
    if (isJsxParent(v)) {
      const children = v.children as t.Node[];
      const idx = children.indexOf(node);
      if (idx >= 0) {
        return {
          container: node,
          parent: { children },
          index: idx,
          anchor,
        };
      }
    }
    current = current.parent;
  }
  return null;
}

function findCommentContainerById(
  ast: t.File,
  commentId: string
): CommentContainerMatch | null {
  let match: CommentContainerMatch | null = null;

  recast.visit(ast, {
    visitJSXExpressionContainer(p) {
      if (match) {
        return false;
      }
      const node = p.node as t.JSXExpressionContainer;
      const blocks = collectCommentBlocks(node);
      let anchor: string | null = null;
      let matched = false;
      for (const block of blocks) {
        const foundAnchor = anchorFromCommentBlock(block, commentId);
        if (foundAnchor === undefined) {
          continue;
        }
        anchor = foundAnchor;
        matched = true;
        break;
      }
      if (!matched) {
        this.traverse(p);
        return;
      }
      match = locateCommentContainerParent(node, p.parent, anchor);
      return false;
    },
  });

  return match;
}

function isAnchorReferencedInAst(ast: t.File, anchor: string): boolean {
  let referenced = false;

  recast.visit(ast, {
    visitJSXExpressionContainer(p) {
      if (referenced) {
        return false;
      }
      const node = p.node as t.JSXExpressionContainer;
      const blocks = collectCommentBlocks(node);
      for (const block of blocks) {
        if (block.type !== "CommentBlock") {
          continue;
        }
        const trimmed = block.value.trim();
        if (!trimmed.startsWith("@comment")) {
          continue;
        }
        const anchorMatch = block.value.match(ANCHOR_ATTR_RE);
        if (anchorMatch && anchorMatch[1] === anchor) {
          referenced = true;
          return false;
        }
      }
      this.traverse(p);
      return;
    },
  });

  return referenced;
}

/**
 * Remove the `{/* @comment id="<commentId>" ... *\/}` JSXExpressionContainer
 * from the file. When the deleted marker was the only one referencing its
 * `anchor`, the `data-comment-anchor="<anchor>"` attribute is also removed
 * from the JSXElement that carried it (so the source goes back to its
 * pre-comment shape). When other sibling markers still reference the anchor,
 * the attribute is preserved.
 *
 * Whitespace cleanup: when removing the marker we also strip the JSXText
 * fragment IMMEDIATELY preceding it if it ends in a newline + indent — this
 * prevents successive deletes from leaving piles of blank lines.
 *
 * Throws WriteError(404) when no `@comment` block with that id is found in the
 * file. Throws WriteError(500) when the resulting source fails to re-parse.
 */
export async function deleteCommentMarker(
  input: DeleteCommentMarkerInput
): Promise<DeleteCommentMarkerResult> {
  const source = await readFile(input.absolutePath, "utf8");
  const ast = recast.parse(source, { parser: babelTsParser });

  const located = findCommentContainerById(ast, input.commentId);
  if (!located) {
    throw new WriteError(
      `comment marker not found in file: id="${input.commentId}"`,
      404
    );
  }

  const {
    parent: targetParent,
    index: targetIndex,
    anchor: targetAnchor,
  } = located;

  // Splice the marker out. If the preceding sibling is JSXText that ends in a
  // newline + whitespace, strip that trailing whitespace too so we don't leave
  // a blank line behind. We're careful: only the trailing newline+indent run
  // is removed, the rest of the JSXText (text content from earlier siblings)
  // stays intact.
  const parent = targetParent as { children: t.Node[] };
  const children = parent.children;
  const removeFrom = targetIndex;
  let removeCount = 1;

  const prev = children[removeFrom - 1];
  if (prev && prev.type === "JSXText") {
    const text = (prev as t.JSXText).value;
    // Trim trailing `\n[ \t]*` so the next sibling on a new line lands flush
    // against the previous element's closing tag. Falls back to removing the
    // whole node when it was nothing but whitespace.
    const stripped = text.replace(TRAILING_NEWLINE_INDENT_RE, "");
    if (stripped.length === 0) {
      // It was purely whitespace — fold it into the splice so we don't leave
      // an orphan empty JSXText behind.
      removeCount += 1;
      children.splice(removeFrom - 1, removeCount);
    } else if (stripped === text) {
      children.splice(removeFrom, removeCount);
    } else {
      (prev as t.JSXText).value = stripped;
      children.splice(removeFrom, removeCount);
    }
  } else {
    children.splice(removeFrom, removeCount);
  }

  // Decide whether to also remove the `data-comment-anchor` attribute.
  // Scan the AST AFTER removal for any other @comment blocks referencing the
  // same anchor. Zero remaining = strip the attribute.
  const anchorStillReferenced =
    targetAnchor !== null && isAnchorReferencedInAst(ast, targetAnchor);

  let removedAnchor = false;
  if (targetAnchor !== null && !anchorStillReferenced) {
    const stripped = stripAnchorAttribute(ast, targetAnchor);
    removedAnchor = stripped;
  }

  const output = recast.print(ast).code;
  try {
    parseBabel(output, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WriteError(
      `deleteCommentMarker: generated output failed to re-parse: ${message}`,
      500
    );
  }

  await atomicWrite(input.absolutePath, output);

  return { removedAnchor };
}
