import { readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseBabel } from "@babel/parser";
import type * as t from "@babel/types";
import recast from "recast";
import babelTsParser from "recast/parsers/babel-ts.js";
import {
  buildMarkerFromInner,
  findJsxElementByAnchor,
  insertAfterSibling,
  pushComments,
} from "./writer-ast.ts";
import { WriteError } from "./writer-errors.ts";

export interface StoredCommentReply {
  author: string;
  date: string;
  text: string;
  v?: number;
}

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
  commentId: string
): string | null {
  const ast = recast.parse(source, { parser: babelTsParser });
  let result: string | null = null;
  recast.visit(ast, {
    visitJSXExpressionContainer(p) {
      if (result !== null) {
        return false;
      }
      const node = p.node as t.JSXExpressionContainer;
      if (node.expression.type !== "JSXEmptyExpression") {
        this.traverse(p);
        return;
      }
      const blocks: t.Comment[] = [];
      pushComments(node.expression.innerComments, blocks);
      pushComments(node.expression.leadingComments, blocks);
      pushComments(node.expression.trailingComments, blocks);
      for (const block of blocks) {
        if (block.type !== "CommentBlock") {
          continue;
        }
        const trimmed = block.value.trim();
        if (!trimmed.startsWith("@comment")) {
          continue;
        }
        const idMatch = block.value.match(/\bid="([^"]+)"/);
        if (!idMatch || idMatch[1] !== commentId) {
          continue;
        }
        result = block.value;
        return false;
      }
      this.traverse(p);
      return;
    },
  });
  return result;
}

/**
 * Replace the `{/* @comment id="<commentId>" ... *\/}` block in `source` with
 * `directiveInner` (raw text between `/*` and `*\/`). Used when activating an
 * iteration snapshot so overlay metadata (replies, text, resolved, etc.) from
 * the live marker is not clobbered by an older snapshot copy of the directive.
 */
export function replaceCommentMarkerInSource(
  source: string,
  commentId: string,
  directiveInner: string
): string {
  const ast = recast.parse(source, { parser: babelTsParser });
  let replaced = false;
  recast.visit(ast, {
    visitJSXExpressionContainer(p) {
      if (replaced) {
        return false;
      }
      const node = p.node as t.JSXExpressionContainer;
      if (node.expression.type !== "JSXEmptyExpression") {
        this.traverse(p);
        return;
      }
      const blocks: t.Comment[] = [];
      pushComments(node.expression.innerComments, blocks);
      pushComments(node.expression.leadingComments, blocks);
      pushComments(node.expression.trailingComments, blocks);
      for (const block of blocks) {
        if (block.type !== "CommentBlock") {
          continue;
        }
        const trimmed = block.value.trim();
        if (!trimmed.startsWith("@comment")) {
          continue;
        }
        const idMatch = block.value.match(/\bid="([^"]+)"/);
        if (!idMatch || idMatch[1] !== commentId) {
          continue;
        }
        block.value = directiveInner;
        replaced = true;
        return false;
      }
      this.traverse(p);
      return;
    },
  });
  if (!replaced) {
    throw new WriteError(
      `no @comment with id="${commentId}" found in source`,
      404
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
      `replaceCommentMarkerInSource: generated output failed to re-parse: ${message}`,
      500
    );
  }
  return output;
}

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
  directiveInner: string
): string {
  const ast = recast.parse(source, { parser: babelTsParser });

  // Locate the element bearing data-comment-anchor="<anchorUuid>".
  const target = findJsxElementByAnchor(ast, anchorUuid);
  if (!target) {
    throw new WriteError(
      `no JSXElement with data-comment-anchor="${anchorUuid}" in source`,
      400
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
      500
    );
  }

  return output;
}

export function readActiveFromDirective(raw: string): number {
  const match = raw.match(/\bactive=(-?[0-9]+)/);
  if (!match?.[1]) {
    return 0;
  }
  const n = Number.parseInt(match[1], 10);
  if (!Number.isInteger(n) || n < 0) {
    return 0;
  }
  return n;
}

export function setActiveOnDirective(raw: string, active: number): string {
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
export function setTextOnDirective(raw: string, text: string): string {
  const replacement = `text=${JSON.stringify(text)}`;
  const existing = /\btext=(?:"(?:\\.|[^"\\])*")/;
  if (!existing.test(raw)) {
    throw new WriteError(
      "setTextOnDirective: directive is missing required text attribute",
      500
    );
  }
  return raw.replace(existing, replacement);
}

export function appendReplyOnDirective(
  raw: string,
  reply: StoredCommentReply
): string {
  const existing = readRepliesFromDirective(raw);
  existing.push(reply);
  return setRepliesOnDirective(raw, existing);
}

export function updateReplyOnDirective(
  raw: string,
  replyIndex: number,
  text: string
): string {
  const existing = readRepliesFromDirective(raw);
  if (replyIndex >= existing.length) {
    throw new WriteError(`reply index ${replyIndex} out of range`, 400);
  }
  const reply = existing[replyIndex];
  existing[replyIndex] = { ...reply, text };
  return setRepliesOnDirective(raw, existing);
}

export function deleteReplyOnDirective(
  raw: string,
  replyIndex: number
): string {
  const existing = readRepliesFromDirective(raw);
  if (replyIndex >= existing.length) {
    throw new WriteError(`reply index ${replyIndex} out of range`, 400);
  }
  existing.splice(replyIndex, 1);
  return setRepliesOnDirective(raw, existing);
}

function setRepliesOnDirective(
  raw: string,
  replies: StoredCommentReply[]
): string {
  const serialized = `replies=${JSON.stringify(replies)}`;
  const idx = raw.search(/\breplies=/);
  if (idx >= 0) {
    let pos = idx + "replies=".length;
    while (pos < raw.length && raw[pos] === " ") {
      pos++;
    }
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
  if (idx < 0) {
    return [];
  }
  let pos = idx + "replies=".length;
  while (pos < raw.length && raw[pos] === " ") {
    pos++;
  }
  const bracket = readBalancedSlice(raw, pos, "[", "]");
  if (!bracket) {
    return [];
  }
  try {
    const parsed = JSON.parse(bracket.slice) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: StoredCommentReply[] = [];
    for (const el of parsed) {
      if (!el || typeof el !== "object") {
        continue;
      }
      const obj = el as Record<string, unknown>;
      if (
        typeof obj.author === "string" &&
        typeof obj.date === "string" &&
        typeof obj.text === "string"
      ) {
        const reply: StoredCommentReply = {
          author: obj.author,
          date: obj.date,
          text: obj.text,
        };
        if (
          typeof obj.v === "number" &&
          Number.isInteger(obj.v) &&
          obj.v >= 0
        ) {
          reply.v = obj.v;
        }
        out.push(reply);
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
  close: string
): { slice: string; next: number } | null {
  if (source[start] !== open) {
    return null;
  }
  let depth = 0;
  let j = start;
  while (j < source.length) {
    const c = source.charAt(j);
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
    if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) {
        return { slice: source.slice(start, j + 1), next: j + 1 };
      }
    }
    j++;
  }
  return null;
}

export async function mutateCommentDirectiveById(
  absolutePath: string,
  commentId: string,
  mutate: (directiveValue: string) => string,
  operationName: string
): Promise<void> {
  const source = await readFile(absolutePath, "utf8");
  const ast = recast.parse(source, { parser: babelTsParser });

  let mutated = false;
  recast.visit(ast, {
    visitJSXExpressionContainer(p) {
      const node = p.node as t.JSXExpressionContainer;
      if (node.expression.type !== "JSXEmptyExpression") {
        this.traverse(p);
        return;
      }
      const blocks: t.Comment[] = [];
      pushComments(node.expression.innerComments, blocks);
      pushComments(node.expression.leadingComments, blocks);
      pushComments(node.expression.trailingComments, blocks);

      for (const block of blocks) {
        if (block.type !== "CommentBlock") {
          continue;
        }
        const trimmed = block.value.trim();
        if (!trimmed.startsWith("@comment")) {
          continue;
        }
        const idMatch = block.value.match(/\bid="([^"]+)"/);
        if (!idMatch || idMatch[1] !== commentId) {
          continue;
        }

        block.value = mutate(block.value);
        mutated = true;
        return false;
      }
      this.traverse(p);
      return;
    },
  });

  if (!mutated) {
    throw new WriteError(
      `no @comment with id="${commentId}" found in ${absolutePath}`,
      404
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
      500
    );
  }

  await atomicWrite(absolutePath, output);
}

export async function atomicWrite(
  absolutePath: string,
  content: string
): Promise<void> {
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
      500
    );
  }
}
