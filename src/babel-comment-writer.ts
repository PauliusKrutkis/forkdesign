/**
 * AST writer for inserting `{/* @comment ... *\/}` markers into a `.tsx` page
 * file.
 *
 * Used by the dev-only Vite plugin (`vite-plugin-comments.ts`) to serve the
 * `POST /api/comments` write path. Formatting-preserving via `recast` so we
 * don't churn unrelated regions of the file each time a comment is added.
 *
 * Scope (W4 write path):
 *   - Locate a JSXElement at (line, column) — 1-indexed, matches loc.start.
 *   - Ensure the element carries `data-comment-anchor="<uuid>"`; reuse an
 *     existing value when one is already present.
 *   - Insert a sibling `{/* @comment id=... anchor=... text=... ... *\/}`
 *     immediately after the target.
 *
 * Anything dynamic (the user's `text` and `author`) is encoded with
 * `JSON.stringify` so quotes, backslashes, and newlines survive a round-trip
 * through the directive's tiny attribute parser without bespoke escaping.
 */
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import recast from "recast";
// recast ships a Babel-TS parser shim that mirrors the @babel/parser options
// used by the reader (jsx + typescript).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import babelTsParser from "recast/parsers/babel-ts.js";
import { parse as parseBabel } from "@babel/parser";
import * as t from "@babel/types";

export type WriteCommentInput = {
  /** Absolute path to the .tsx file. */
  absolutePath: string;
  /** 1-indexed line of the target JSXElement (Babel-style loc.start.line). */
  line: number;
  /** 1-indexed column of the `<` of the target JSXElement. */
  column: number;
  /** Body text from the composer. */
  text: string;
  /** Author identifier (email). */
  author: string;
  /**
   * If the target element already has `data-comment-anchor`, the caller may
   * pass it through so we don't mint a new uuid. When omitted, an existing
   * attribute on the AST is reused as the anchor, otherwise a fresh uuid is
   * minted and added.
   */
  existingAnchor?: string;
  /**
   * Optional repo-root absolute path to the cropped PNG saved at comment time
   * (e.g. `/designs/iterations/<id>/v0.png`). When provided, the writer emits
   * `screenshot="..."` on the directive so the reader can surface it.
   */
  screenshot?: string;
  /**
   * Optional pre-allocated uuid to stamp as the directive's `id`. Callers use
   * this when they need the id BEFORE the write (e.g. to compute a screenshot
   * path under `/designs/iterations/<id>/v0.png`). When omitted the writer
   * mints a fresh uuid as before.
   */
  id?: string;
  /**
   * Optional app route (pathname + search + hash) stamped on the directive so
   * the overlay can navigate back to the page where the comment was created.
   */
  route?: string;
};

export type WriteCommentResult = {
  /** uuid v4 written as the directive's `id="..."`. */
  id: string;
  /** uuid written as `anchor="..."` and as `data-comment-anchor` on the target. */
  anchor: string;
  /** ISO 8601 date string written as `date="..."`. */
  date: string;
};

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
  input: WriteCommentInput,
): Promise<WriteCommentResult> {
  const source = await readFile(input.absolutePath, "utf8");
  const ast = recast.parse(source, { parser: babelTsParser });

  const target = findJsxElementAt(ast, input.line, input.column);
  if (!target) {
    throw new WriteError(
      `no JSXElement found at line:column ${input.line}:${input.column}`,
      400,
    );
  }

  // 1. Resolve the anchor uuid. Reuse an existing data-comment-anchor when
  //    present (callers may also pass `existingAnchor` to be explicit).
  const existingAnchorOnNode = readAttrValue(
    target.openingElement,
    "data-comment-anchor",
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
    throw new WriteError(`generated output failed to re-parse: ${message}`, 500);
  }

  await atomicWrite(input.absolutePath, output);

  return { id, anchor: anchorUuid, date };
}

// ---------------------------------------------------------------------------
// Extract the raw directive inner for an existing @comment marker
// ---------------------------------------------------------------------------

/**
 * Find the `{/* @comment id="<commentId>" ... *\/}` block in `source` and
 * return its raw inner text — i.e. everything between `/*` and `*\/`,
 * preserving leading/trailing whitespace verbatim. Returns null when no
 * matching marker exists.
 *
 * Used by the activate path to recover the FULL directive (including text,
 * author, date, screenshot, active, etc.) so it can be injected into a legacy
 * `v{N}.tsx` snapshot that pre-dates the marker.
 */
export function extractDirectiveInner(
  source: string,
  commentId: string,
): string | null {
  const ast = recast.parse(source, { parser: babelTsParser });
  let result: string | null = null;
  recast.visit(ast, {
    visitJSXExpressionContainer(p) {
      if (result !== null) return false;
      const node = p.node as t.JSXExpressionContainer;
      if (node.expression.type !== "JSXEmptyExpression") {
        this.traverse(p);
        return undefined;
      }
      const blocks: t.Comment[] = [];
      pushComments(node.expression.innerComments, blocks);
      pushComments(node.expression.leadingComments, blocks);
      pushComments(node.expression.trailingComments, blocks);
      for (const block of blocks) {
        if (block.type !== "CommentBlock") continue;
        const trimmed = block.value.trim();
        if (!trimmed.startsWith("@comment")) continue;
        const idMatch = block.value.match(/\bid="([^"]+)"/);
        if (!idMatch || idMatch[1] !== commentId) continue;
        result = block.value;
        return false;
      }
      this.traverse(p);
      return undefined;
    },
  });
  return result;
}

// ---------------------------------------------------------------------------
// Inject a pre-built marker into a source string (no disk I/O)
// ---------------------------------------------------------------------------

/**
 * Inject a pre-built `{/* @comment ... *\/}` directive into `source` as a
 * sibling of the JSX element carrying `data-comment-anchor="<anchorUuid>"`.
 *
 * This is the recovery path for legacy iteration snapshots: a `v{N}.tsx` that
 * still has the `data-comment-anchor` attribute on the element but is missing
 * the `{/* @comment ... *\/}` block (because it was captured BEFORE the marker
 * was written to disk — see bug #24). We rebuild the marker as a sibling using
 * the same insertion logic the writer uses for fresh markers.
 *
 * `directiveInner` is the raw text BETWEEN the `/*` and `*\/` of the original
 * block (e.g. `" @comment id=\"...\" anchor=\"...\" text=\"...\" ... "`,
 * usually with a leading space). The caller pulls it off the current source
 * file's AST so attributes (text, author, date, screenshot, active, etc.) are
 * preserved verbatim.
 *
 * Returns the new source. Throws `WriteError(400)` when no element carries
 * the supplied anchor uuid. Throws `WriteError(500)` for parse/print failures.
 */
export function injectExistingMarkerIntoSource(
  source: string,
  anchorUuid: string,
  directiveInner: string,
): string {
  const ast = recast.parse(source, { parser: babelTsParser });

  // Locate the element bearing data-comment-anchor="<anchorUuid>".
  const target = findJsxElementByAnchor(ast, anchorUuid);
  if (!target) {
    throw new WriteError(
      `no JSXElement with data-comment-anchor="${anchorUuid}" in source`,
      400,
    );
  }

  // Build the marker from the existing directive text. The wrap-and-extract
  // trick from buildCommentMarker also works here: we just stuff the original
  // directive between the comment markers.
  const marker = buildMarkerFromInner(directiveInner);

  insertAfterSibling(ast, target, marker);

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
      `injectExistingMarkerIntoSource: generated output failed to re-parse: ${message}`,
      500,
    );
  }

  return output;
}

/**
 * Find the JSXElement carrying `data-comment-anchor="<anchorUuid>"`. Mirrors
 * `findJsxElementAt` but matches on attribute value instead of source loc.
 */
function findJsxElementByAnchor(
  ast: t.File,
  anchorUuid: string,
): t.JSXElement | null {
  let found: t.JSXElement | null = null;
  recast.visit(ast, {
    visitJSXElement(jsxPath) {
      if (found) return false;
      const node = jsxPath.node as t.JSXElement;
      const v = readAttrValue(node.openingElement, "data-comment-anchor");
      if (v === anchorUuid) {
        found = node;
        return false;
      }
      this.traverse(jsxPath);
      return undefined;
    },
  });
  return found;
}

/**
 * Build a JSXExpressionContainer from the RAW inner text of an existing
 * CommentBlock (i.e. everything between `/*` and `*\/`). The wrap-and-extract
 * trick is identical to buildCommentMarker, but here we don't reconstruct the
 * directive's attributes — we keep the original bytes verbatim so text,
 * author, date, screenshot, replies, etc. round-trip without any escaping
 * gymnastics.
 */
function buildMarkerFromInner(
  directiveInner: string,
): t.JSXExpressionContainer {
  // The directive must not contain "*/" (would close the block early). If it
  // does, the original source was malformed — bail rather than emit broken JS.
  if (directiveInner.includes("*/")) {
    throw new WriteError(
      "injectExistingMarkerIntoSource: directive contains '*/' (would close block early)",
      500,
    );
  }
  const wrap = `<>{/*${directiveInner}*/}</>;`;
  const wrapped = recast.parse(wrap, { parser: babelTsParser }) as t.File;
  let found: t.JSXExpressionContainer | null = null;
  recast.visit(wrapped, {
    visitJSXExpressionContainer(p) {
      found = p.node as t.JSXExpressionContainer;
      return false;
    },
  });
  if (!found) {
    throw new WriteError(
      "internal: failed to construct @comment marker node from inner text",
      500,
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// Update `active=N` on an existing @comment marker
// ---------------------------------------------------------------------------

export type UpdateCommentActiveInput = {
  /** Absolute path to the .tsx file containing the marker. */
  absolutePath: string;
  /** uuid that matches the `id` attribute on the `@comment` directive. */
  commentId: string;
  /** New value for the directive's `active=N` attribute. */
  active: number;
};

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
  input: UpdateCommentActiveInput,
): Promise<void> {
  if (!Number.isInteger(input.active) || input.active < 0) {
    throw new WriteError(
      `active must be a non-negative integer (got ${input.active})`,
      400,
    );
  }
  await mutateCommentDirectiveById(
    input.absolutePath,
    input.commentId,
    (raw) => setActiveOnDirective(raw, input.active),
    "updateCommentActive",
  );
}

export type UpdateCommentTextInput = {
  /** Absolute path to the .tsx file containing the marker. */
  absolutePath: string;
  /** uuid that matches the `id` attribute on the `@comment` directive. */
  commentId: string;
  /** New body text for the comment. */
  text: string;
};

/**
 * Find the `{/* @comment id="<commentId>" ... *\/}` block and replace its
 * `text=...` attribute. Uses `JSON.stringify` for the value so the encoding
 * matches `buildCommentMarker`.
 */
export async function updateCommentText(
  input: UpdateCommentTextInput,
): Promise<void> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new WriteError("text must be non-empty", 400);
  }
  await mutateCommentDirectiveById(
    input.absolutePath,
    input.commentId,
    (raw) => setTextOnDirective(raw, text),
    "updateCommentText",
  );
}

export type AppendCommentReplyInput = {
  /** Absolute path to the .tsx file containing the marker. */
  absolutePath: string;
  /** uuid that matches the `id` attribute on the `@comment` directive. */
  commentId: string;
  reply: {
    author: string;
    text: string;
  };
};

export type AppendCommentReplyResult = {
  author: string;
  date: string;
  text: string;
};

/**
 * Append a flat reply to the `@comment` marker's `replies=[...]` array.
 * Creates the attribute when missing. The server stamps `date` as ISO 8601.
 */
export async function appendCommentReply(
  input: AppendCommentReplyInput,
): Promise<AppendCommentReplyResult> {
  const author = input.reply.author.trim();
  const text = input.reply.text.trim();
  if (author.length === 0) {
    throw new WriteError("reply author must be non-empty", 400);
  }
  if (text.length === 0) {
    throw new WriteError("reply text must be non-empty", 400);
  }
  const reply: AppendCommentReplyResult = {
    author,
    date: new Date().toISOString(),
    text,
  };
  await mutateCommentDirectiveById(
    input.absolutePath,
    input.commentId,
    (raw) => appendReplyOnDirective(raw, reply),
    "appendCommentReply",
  );
  return reply;
}

type StoredCommentReply = {
  author: string;
  date: string;
  text: string;
};

async function mutateCommentDirectiveById(
  absolutePath: string,
  commentId: string,
  mutate: (directiveValue: string) => string,
  operationName: string,
): Promise<void> {
  const source = await readFile(absolutePath, "utf8");
  const ast = recast.parse(source, { parser: babelTsParser });

  let mutated = false;
  recast.visit(ast, {
    visitJSXExpressionContainer(p) {
      const node = p.node as t.JSXExpressionContainer;
      if (node.expression.type !== "JSXEmptyExpression") {
        this.traverse(p);
        return undefined;
      }
      const blocks: t.Comment[] = [];
      pushComments(node.expression.innerComments, blocks);
      pushComments(node.expression.leadingComments, blocks);
      pushComments(node.expression.trailingComments, blocks);

      for (const block of blocks) {
        if (block.type !== "CommentBlock") continue;
        const trimmed = block.value.trim();
        if (!trimmed.startsWith("@comment")) continue;
        const idMatch = block.value.match(/\bid="([^"]+)"/);
        if (!idMatch || idMatch[1] !== commentId) continue;

        block.value = mutate(block.value);
        mutated = true;
        return false;
      }
      this.traverse(p);
      return undefined;
    },
  });

  if (!mutated) {
    throw new WriteError(
      `no @comment with id="${commentId}" found in ${absolutePath}`,
      404,
    );
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
      `${operationName}: generated output failed to re-parse: ${message}`,
      500,
    );
  }

  await atomicWrite(absolutePath, output);
}

function pushComments(
  list: ReadonlyArray<t.Comment> | null | undefined,
  out: t.Comment[],
): void {
  if (!list) return;
  for (const c of list) out.push(c);
}

/**
 * Apply the `active=N` directive attribute to a raw CommentBlock value
 * (everything BETWEEN the `/*` and `*\/` markers — recast stores it that way).
 *
 * Cases:
 *   - Already has `active=...` somewhere: replace the value in place.
 *   - Missing: append ` active=N` at the end of the directive token list,
 *     preserving any trailing whitespace that was on the original line.
 */
function setActiveOnDirective(raw: string, active: number): string {
  // Replace existing `active=<digits>` (handle optional minus, though we
  // forbid negative on input). Word-boundary so we don't match e.g.
  // `inactive=...`.
  const existing = /\bactive=-?[0-9]+/;
  if (existing.test(raw)) {
    return raw.replace(existing, `active=${active}`);
  }
  // Preserve trailing whitespace on the comment-block value so the
  // closing `*/` keeps its spacing. Split into [content][trailingSpace].
  const m = raw.match(/^([\s\S]*?)(\s*)$/);
  const content = m ? m[1] : raw;
  const trail = m ? m[2] : "";
  // Add a single space between the last attr and our addition.
  const sep = content.length > 0 && !/\s$/.test(content) ? " " : "";
  return `${content}${sep}active=${active}${trail}`;
}

/**
 * Replace the `text=...` attribute on a directive. The value is always
 * emitted as `text=${JSON.stringify(text)}` to match `buildCommentMarker`.
 */
function setTextOnDirective(raw: string, text: string): string {
  const replacement = `text=${JSON.stringify(text)}`;
  const existing = /\btext=(?:"(?:\\.|[^"\\])*")/;
  if (!existing.test(raw)) {
    throw new WriteError(
      "setTextOnDirective: directive is missing required text attribute",
      500,
    );
  }
  return raw.replace(existing, replacement);
}

function appendReplyOnDirective(
  raw: string,
  reply: StoredCommentReply,
): string {
  const existing = readRepliesFromDirective(raw);
  existing.push(reply);
  return setRepliesOnDirective(raw, existing);
}

function setRepliesOnDirective(
  raw: string,
  replies: StoredCommentReply[],
): string {
  const serialized = `replies=${JSON.stringify(replies)}`;
  const idx = raw.search(/\breplies=/);
  if (idx >= 0) {
    let pos = idx + "replies=".length;
    while (pos < raw.length && raw[pos] === " ") pos++;
    const bracket = readBalancedSlice(raw, pos, "[", "]");
    if (bracket) {
      return raw.slice(0, idx) + serialized + raw.slice(bracket.next);
    }
  }
  const m = raw.match(/^([\s\S]*?)(\s*)$/);
  const content = m ? m[1] : raw;
  const trail = m ? m[2] : "";
  const sep = content.length > 0 && !/\s$/.test(content) ? " " : "";
  return `${content}${sep}${serialized}${trail}`;
}

function readRepliesFromDirective(raw: string): StoredCommentReply[] {
  const idx = raw.search(/\breplies=/);
  if (idx < 0) return [];
  let pos = idx + "replies=".length;
  while (pos < raw.length && raw[pos] === " ") pos++;
  const bracket = readBalancedSlice(raw, pos, "[", "]");
  if (!bracket) return [];
  try {
    const parsed = JSON.parse(bracket.slice) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: StoredCommentReply[] = [];
    for (const el of parsed) {
      if (!el || typeof el !== "object") continue;
      const obj = el as Record<string, unknown>;
      if (
        typeof obj.author === "string" &&
        typeof obj.date === "string" &&
        typeof obj.text === "string"
      ) {
        out.push({
          author: obj.author,
          date: obj.date,
          text: obj.text,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function readBalancedSlice(
  source: string,
  start: number,
  open: string,
  close: string,
): { slice: string; next: number } | null {
  if (source[start] !== open) return null;
  let depth = 0;
  let j = start;
  while (j < source.length) {
    const c = source[j]!;
    if (c === '"' || c === "'") {
      const q = c;
      j++;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === q) {
          j++;
          break;
        }
        j++;
      }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        return { slice: source.slice(start, j + 1), next: j + 1 };
      }
    }
    j++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Delete an @comment marker (and optionally its anchor attribute)
// ---------------------------------------------------------------------------

export type DeleteCommentMarkerInput = {
  /** Absolute path to the .tsx file containing the marker. */
  absolutePath: string;
  /** uuid matching the `id` attribute on the `@comment` directive. */
  commentId: string;
};

export type DeleteCommentMarkerResult = {
  /**
   * True when the target was the last @comment block referencing the anchor
   * and we therefore also stripped `data-comment-anchor="<anchor>"` from the
   * JSXElement that carried it. False when other sibling @comment markers
   * still reference the anchor and the attribute was preserved.
   */
  removedAnchor: boolean;
};

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
  input: DeleteCommentMarkerInput,
): Promise<DeleteCommentMarkerResult> {
  const source = await readFile(input.absolutePath, "utf8");
  const ast = recast.parse(source, { parser: babelTsParser });

  // Locate the JSXExpressionContainer carrying our @comment block. We also
  // capture the parent (JSXElement / JSXFragment) and the index inside its
  // `children` array so we can splice the node out.
  let targetContainer: t.JSXExpressionContainer | null = null;
  let targetParent: { children: t.Node[] } | null = null;
  let targetIndex = -1;
  let targetAnchor: string | null = null;

  recast.visit(ast, {
    visitJSXExpressionContainer(p) {
      if (targetContainer) return false;
      const node = p.node as t.JSXExpressionContainer;
      if (node.expression.type !== "JSXEmptyExpression") {
        this.traverse(p);
        return undefined;
      }
      const blocks: t.Comment[] = [];
      pushComments(node.expression.innerComments, blocks);
      pushComments(node.expression.leadingComments, blocks);
      pushComments(node.expression.trailingComments, blocks);
      let matched = false;
      let anchor: string | null = null;
      for (const block of blocks) {
        if (block.type !== "CommentBlock") continue;
        const trimmed = block.value.trim();
        if (!trimmed.startsWith("@comment")) continue;
        const idMatch = block.value.match(/\bid="([^"]+)"/);
        if (!idMatch || idMatch[1] !== input.commentId) continue;
        const anchorMatch = block.value.match(/\banchor="([^"]+)"/);
        anchor = anchorMatch ? (anchorMatch[1] ?? null) : null;
        matched = true;
        break;
      }
      if (!matched) {
        this.traverse(p);
        return undefined;
      }
      // Walk up to find the JSX parent and resolve the index in its children.
      let parentPath = p.parent;
      while (parentPath) {
        const v = parentPath.value as unknown;
        if (isJsxParent(v)) {
          const children = v.children as t.Node[];
          const idx = children.indexOf(node);
          if (idx >= 0) {
            targetContainer = node;
            targetParent = { children };
            targetIndex = idx;
            targetAnchor = anchor;
            return false;
          }
        }
        parentPath = parentPath.parent;
      }
      // Marker found but no JSX parent (shouldn't happen — markers are always
      // siblings). Fall through and let the not-found error fire so we never
      // silently leave a broken state.
      return false;
    },
  });

  if (!targetContainer || !targetParent) {
    throw new WriteError(
      `comment marker not found in file: id="${input.commentId}"`,
      404,
    );
  }

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
    const stripped = text.replace(/\n[ \t]*$/, "");
    if (stripped.length === 0) {
      // It was purely whitespace — fold it into the splice so we don't leave
      // an orphan empty JSXText behind.
      removeCount += 1;
      children.splice(removeFrom - 1, removeCount);
    } else if (stripped !== text) {
      (prev as t.JSXText).value = stripped;
      children.splice(removeFrom, removeCount);
    } else {
      children.splice(removeFrom, removeCount);
    }
  } else {
    children.splice(removeFrom, removeCount);
  }

  // Decide whether to also remove the `data-comment-anchor` attribute.
  // Scan the AST AFTER removal for any other @comment blocks referencing the
  // same anchor. Zero remaining = strip the attribute.
  let anchorStillReferenced = false;
  if (targetAnchor !== null) {
    recast.visit(ast, {
      visitJSXExpressionContainer(p) {
        if (anchorStillReferenced) return false;
        const node = p.node as t.JSXExpressionContainer;
        if (node.expression.type !== "JSXEmptyExpression") {
          this.traverse(p);
          return undefined;
        }
        const blocks: t.Comment[] = [];
        pushComments(node.expression.innerComments, blocks);
        pushComments(node.expression.leadingComments, blocks);
        pushComments(node.expression.trailingComments, blocks);
        for (const block of blocks) {
          if (block.type !== "CommentBlock") continue;
          const trimmed = block.value.trim();
          if (!trimmed.startsWith("@comment")) continue;
          const anchorMatch = block.value.match(/\banchor="([^"]+)"/);
          if (anchorMatch && anchorMatch[1] === targetAnchor) {
            anchorStillReferenced = true;
            return false;
          }
        }
        this.traverse(p);
        return undefined;
      },
    });
  }

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
      500,
    );
  }

  await atomicWrite(input.absolutePath, output);

  return { removedAnchor };
}

/**
 * Remove the `data-comment-anchor="<anchorUuid>"` attribute from whichever
 * JSXOpeningElement carries it. Returns true when a match was found and
 * stripped. Used by deleteCommentMarker after confirming the anchor has no
 * remaining references.
 */
function stripAnchorAttribute(ast: t.File, anchorUuid: string): boolean {
  let stripped = false;
  recast.visit(ast, {
    visitJSXOpeningElement(p) {
      if (stripped) return false;
      const opening = p.node as t.JSXOpeningElement;
      const idx = opening.attributes.findIndex((attr) => {
        if (attr.type !== "JSXAttribute") return false;
        if (attr.name.type !== "JSXIdentifier") return false;
        if (attr.name.name !== "data-comment-anchor") return false;
        const v = attr.value;
        if (!v) return false;
        if (v.type === "StringLiteral") return v.value === anchorUuid;
        if (
          v.type === "JSXExpressionContainer" &&
          v.expression.type === "StringLiteral"
        ) {
          return v.expression.value === anchorUuid;
        }
        return false;
      });
      if (idx >= 0) {
        opening.attributes.splice(idx, 1);
        stripped = true;
        return false;
      }
      this.traverse(p);
      return undefined;
    },
  });
  return stripped;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Tagged error so the HTTP layer can map our failures back to the right
 * status code without re-parsing the message.
 */
export class WriteError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WriteError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Locating the target JSXElement
// ---------------------------------------------------------------------------

/**
 * Find the JSXElement whose `loc.start` is at (line, column - 1). Babel
 * columns are 0-indexed; the overlay sends 1-indexed values matching the
 * `<` token, so we subtract 1 when matching.
 *
 * If no exact match exists, fall back to the JSXElement on the same line
 * with the smallest column delta — this forgives an off-by-one in either
 * direction (e.g. a caller that already converted).
 */
function findJsxElementAt(
  ast: t.File,
  line: number,
  column: number,
): t.JSXElement | null {
  const targetCol = column - 1;
  let exact: t.JSXElement | null = null;
  let bestFallback: { node: t.JSXElement; delta: number } | null = null;

  recast.visit(ast, {
    visitJSXElement(jsxPath) {
      const node = jsxPath.node as t.JSXElement;
      const loc = node.loc;
      if (loc && loc.start.line === line) {
        if (loc.start.column === targetCol) {
          exact = node;
          return false;
        }
        const delta = Math.abs(loc.start.column - targetCol);
        if (!bestFallback || delta < bestFallback.delta) {
          bestFallback = { node, delta };
        }
      }
      this.traverse(jsxPath);
      return undefined;
    },
  });

  if (exact) return exact;
  // Only accept a fallback if it's within 1 column — protects against
  // matching a totally unrelated element on the same line.
  if (bestFallback !== null) {
    const fb = bestFallback as { node: t.JSXElement; delta: number };
    if (fb.delta <= 1) {
      return fb.node;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

function readAttrValue(
  opening: t.JSXOpeningElement,
  name: string,
): string | null {
  for (const attr of opening.attributes) {
    if (attr.type !== "JSXAttribute") continue;
    if (attr.name.type !== "JSXIdentifier") continue;
    if (attr.name.name !== name) continue;
    const v = attr.value;
    if (!v) return null;
    if (v.type === "StringLiteral") return v.value;
    if (
      v.type === "JSXExpressionContainer" &&
      v.expression.type === "StringLiteral"
    ) {
      return v.expression.value;
    }
    return null;
  }
  return null;
}

function addAttribute(
  opening: t.JSXOpeningElement,
  name: string,
  value: string,
): void {
  opening.attributes.push(
    t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value)),
  );
}

// ---------------------------------------------------------------------------
// Marker construction
// ---------------------------------------------------------------------------

type MarkerArgs = {
  id: string;
  anchor: string;
  text: string;
  author: string;
  date: string;
  /**
   * Optional repo-root absolute path to the saved screenshot, e.g.
   * `/designs/iterations/<id>/v0.png`. Emitted as `screenshot="..."` on the
   * directive when present.
   */
  screenshot?: string;
  route?: string;
};

/**
 * Build the JSXExpressionContainer that holds the comment directive:
 *
 *   {/* @comment id="<uuid>" anchor="<uuid>" text="<escaped>" author="<email>" date="<iso>" *\/}
 *
 * Notes on escaping:
 *   - `text` and `author` go through `JSON.stringify` to get safe quoting and
 *     escape sequences (`\"`, `\\`, `\n`) in one shot. The reader's directive
 *     parser understands the JSON-string subset of those escapes.
 *   - `id`/`anchor`/`date` are tightly constrained shapes (uuid / ISO date) so
 *     a plain `"..."` wrapper is fine.
 *   - `screenshot` is a server-controlled ASCII path (`/designs/iterations/...`)
 *     so a plain `"..."` wrapper is fine; we never write the field at all when
 *     the screenshot save failed.
 *
 * Implementation note: building the node by hand via @babel/types and
 * `addComment(..., "inner")` does NOT survive `recast.print` — recast omits
 * the inner comment and emits a bare `{}`. The reliable workaround is to
 * parse a tiny JSX fragment that already contains the desired comment block,
 * then extract the recast-blessed node from that AST. Recast attaches all the
 * formatting hints it needs during parse, so the node prints faithfully.
 */
function buildCommentMarker(args: MarkerArgs): t.JSXExpressionContainer {
  const directive =
    `@comment id="${args.id}" anchor="${args.anchor}"` +
    ` text=${JSON.stringify(args.text)} author=${JSON.stringify(args.author)}` +
    ` date="${args.date}"` +
    (args.screenshot ? ` screenshot="${args.screenshot}"` : "") +
    (args.route ? ` route=${JSON.stringify(args.route)}` : "");

  // Wrap in a JSX fragment so the parser accepts the bare comment-block
  // expression. We don't render the fragment; we only steal the inner node.
  const wrap = `<>{/* ${directive} */}</>;`;
  const wrapped = recast.parse(wrap, { parser: babelTsParser }) as t.File;

  let found: t.JSXExpressionContainer | null = null;
  recast.visit(wrapped, {
    visitJSXExpressionContainer(p) {
      found = p.node as t.JSXExpressionContainer;
      return false;
    },
  });
  if (!found) {
    throw new WriteError(
      "internal: failed to construct @comment marker node",
      500,
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// Sibling insertion
// ---------------------------------------------------------------------------

/**
 * Insert `marker` immediately after `target` in its parent's children array.
 * Handles two parent shapes:
 *   - JSXElement (most common: target sits inside another element)
 *   - JSXFragment (<>...</>)
 *
 * We also emit a leading JSXText newline + indentation so the marker lands on
 * its own line; without this, recast prints freshly-built siblings flush with
 * the previous element's closing tag.
 */
function insertAfterSibling(
  ast: t.File,
  target: t.JSXElement,
  marker: t.JSXExpressionContainer,
): void {
  let inserted = false;

  recast.visit(ast, {
    visitJSXElement(jsxPath) {
      if (inserted) return false;
      const node = jsxPath.node as t.JSXElement;
      if (node === target) {
        let p = jsxPath.parent;
        while (p) {
          const parentNode = p.value as unknown;
          if (isJsxParent(parentNode)) {
            const children = parentNode.children;
            const idx = children.indexOf(target);
            if (idx >= 0) {
              const indent = inferSiblingIndent(parentNode, children, idx);
              const whitespace = t.jsxText(`\n${indent}`);
              children.splice(idx + 1, 0, whitespace, marker);
              inserted = true;
              return false;
            }
          }
          p = p.parent;
        }
        return false;
      }
      this.traverse(jsxPath);
      return undefined;
    },
  });

  if (inserted) return;

  // Fallback: target has no JSXElement/JSXFragment parent (it's the root of
  // a function return, a conditional consequent, a map callback body, etc.).
  // Wrap the target in a JSX Fragment and place the marker as a sibling
  // within. This works for any JSXElement including self-closing ones, and
  // preserves the original target's formatting.
  recast.visit(ast, {
    visitJSXElement(jsxPath) {
      if (inserted) return false;
      const node = jsxPath.node as t.JSXElement;
      if (node !== target) {
        this.traverse(jsxPath);
        return undefined;
      }
      const col = target.loc?.start.column ?? 0;
      const indent = " ".repeat(col);
      const outerIndent = " ".repeat(Math.max(0, col - 2));
      // Strip recast/babel's "parenthesized" trivia from the target. The parens
      // belong to the original return-expression context; carrying them into
      // the new fragment slot prints `(<label>…</label>)` which is valid JSX
      // but ugly.
      const targetExtra = (target as unknown as { extra?: Record<string, unknown> })
        .extra;
      if (targetExtra && "parenthesized" in targetExtra) {
        targetExtra.parenthesized = false;
        targetExtra.parenStart = undefined;
      }
      const fragment = t.jsxFragment(
        t.jsxOpeningFragment(),
        t.jsxClosingFragment(),
        [
          t.jsxText(`\n${indent}`),
          target,
          t.jsxText(`\n${indent}`),
          marker,
          t.jsxText(`\n${outerIndent}`),
        ],
      );
      jsxPath.replace(fragment);
      inserted = true;
      return false;
    },
  });

  if (!inserted) {
    throw new WriteError(
      "couldn't locate target JSXElement to wrap with marker",
      500,
    );
  }
}

/**
 * Infer the indentation to use for a new sibling inserted at `idx + 1`. We
 * look at the JSXText that precedes the target — that node's last line is
 * the whitespace used to indent the target itself, so reusing it puts the
 * new sibling at the same column.
 */
function inferSiblingIndent(
  parent: t.JSXElement | t.JSXFragment,
  children: ReadonlyArray<t.Node>,
  targetIdx: number,
): string {
  for (let i = targetIdx - 1; i >= 0; i--) {
    const child = children[i];
    if (child && child.type === "JSXText") {
      const raw = child.value;
      const nl = raw.lastIndexOf("\n");
      if (nl >= 0) {
        const indent = raw.slice(nl + 1);
        if (/^[ \t]*$/.test(indent)) return indent;
      }
    }
  }
  const col = parent.loc?.start.column ?? 0;
  return " ".repeat(col + 2);
}

function isJsxParent(
  v: unknown,
): v is { children: Array<t.Node> } & (t.JSXElement | t.JSXFragment) {
  if (!v || typeof v !== "object") return false;
  const node = v as { type?: string; children?: unknown };
  return (
    (node.type === "JSXElement" || node.type === "JSXFragment") &&
    Array.isArray(node.children)
  );
}

// ---------------------------------------------------------------------------
// Atomic-ish write
// ---------------------------------------------------------------------------

async function atomicWrite(absolutePath: string, content: string): Promise<void> {
  // Write to a sibling tmp file (same directory) and rename — this is atomic
  // on the same filesystem volume, which is the common case for source files.
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, absolutePath);
  } catch (err) {
    const hint = tmpdir();
    const message = err instanceof Error ? err.message : String(err);
    throw new WriteError(
      `failed to write file (tmpdir=${hint}): ${message}`,
      500,
    );
  }
}
