import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { atomicWriteText } from "../platform/atomic-write.ts";
import { errorMessage } from "../platform/errors.ts";
import {
  assertValidTsx,
  COMMENT_ID_ATTR_RE,
  forEachCommentBlock,
  parseSourceAst,
  printAst,
} from "./directive-ast.ts";
import {
  buildMarkerFromInner,
  findJsxElementByAnchor,
  insertAfterSibling,
} from "./writer-ast.ts";
import { WriteError } from "./writer-errors.ts";

const ACTIVE_ATTR_RE = /\bactive=(-?[0-9]+)/;
const ACTIVE_VALUE_RE = /\bactive=-?[0-9]+/;
const TRAILING_WHITESPACE_RE = /^([\s\S]*?)(\s*)$/;
const TRAILING_SPACE_RE = /\s$/;
const TEXT_ATTR_RE = /\btext=(?:"(?:\\.|[^"\\])*")/;
const REPLIES_ATTR_RE = /\breplies=/;
const RESOLVED_ATTR_RE = /\bresolved\b/;
const RESOLVED_STRIP_RE = /\s*resolved\b/;

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
  const ast = parseSourceAst(source);
  let result: string | null = null;
  forEachCommentBlock(ast, ({ block }) => {
    const idMatch = block.value.match(COMMENT_ID_ATTR_RE);
    if (idMatch?.[1] === commentId) {
      result = block.value;
      return false;
    }
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
  const ast = parseSourceAst(source);
  let replaced = false;
  forEachCommentBlock(ast, ({ block }) => {
    if (replaced) {
      return false;
    }
    const idMatch = block.value.match(COMMENT_ID_ATTR_RE);
    if (idMatch?.[1] !== commentId) {
      return;
    }
    block.value = directiveInner;
    replaced = true;
    return false;
  });
  if (!replaced) {
    throw new WriteError(
      `no @comment with id="${commentId}" found in source`,
      404
    );
  }

  const output = printAst(ast);
  assertValidTsx(output, "replaceCommentMarkerInSource");
  return output;
}

/**
 * Inject a pre-built `{/* @comment ... *\/}` directive into `source` as a
 * sibling of the JSX element carrying `data-comment-anchor="<anchorUuid>"`.
 *
 * This is the recovery path for legacy iteration snapshots: a `v{N}.tsx` that
 * still has the `data-comment-anchor` attribute on the element but is missing
 * the `{/* @comment ... *\/}` block. We rebuild the marker as a sibling using
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
  const ast = parseSourceAst(source);
  const target = findJsxElementByAnchor(ast, anchorUuid);
  if (!target) {
    throw new WriteError(
      `no JSXElement with data-comment-anchor="${anchorUuid}" in source`,
      400
    );
  }

  const marker = buildMarkerFromInner(directiveInner);
  insertAfterSibling(ast, target, marker);

  const output = printAst(ast);
  assertValidTsx(output, "injectExistingMarkerIntoSource");
  return output;
}

export function readActiveFromDirective(raw: string): number {
  const match = raw.match(ACTIVE_ATTR_RE);
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
  if (ACTIVE_VALUE_RE.test(raw)) {
    return raw.replace(ACTIVE_VALUE_RE, `active=${active}`);
  }
  // Preserve trailing whitespace on the comment-block value so the
  // closing `*/` keeps its spacing. Split into [content][trailingSpace].
  const m = raw.match(TRAILING_WHITESPACE_RE);
  const content = m ? m[1] : raw;
  const trail = m ? m[2] : "";
  // Add a single space between the last attr and our addition.
  const sep = content.length > 0 && !TRAILING_SPACE_RE.test(content) ? " " : "";
  return `${content}${sep}active=${active}${trail}`;
}

export function setCommentActiveInSource(
  source: string,
  commentId: string,
  active: number
): string {
  if (!Number.isInteger(active) || active < 0) {
    throw new WriteError(
      `active must be a non-negative integer (got ${active})`,
      400
    );
  }

  const directiveInner = extractDirectiveInner(source, commentId);
  if (directiveInner === null) {
    throw new WriteError(
      `no @comment with id="${commentId}" found in source`,
      404
    );
  }

  return replaceCommentMarkerInSource(
    source,
    commentId,
    setActiveOnDirective(directiveInner, active)
  );
}

/** Toggle the bare `resolved` flag on a directive (reader parses as boolean). */
export function setResolvedOnDirective(raw: string, resolved: boolean): string {
  const hasResolved = RESOLVED_ATTR_RE.test(raw);
  if (resolved) {
    if (hasResolved) {
      return raw;
    }
    const m = raw.match(TRAILING_WHITESPACE_RE);
    const content = m ? m[1] : raw;
    const trail = m ? m[2] : "";
    const sep =
      content.length > 0 && !TRAILING_SPACE_RE.test(content) ? " " : "";
    return `${content}${sep}resolved${trail}`;
  }
  if (!hasResolved) {
    return raw;
  }
  return raw.replace(RESOLVED_STRIP_RE, "");
}

/**
 * Replace the `text=...` attribute on a directive. The value is always
 * emitted as `text=${JSON.stringify(text)}` to match `buildCommentMarker`.
 */
export function setTextOnDirective(raw: string, text: string): string {
  const replacement = `text=${JSON.stringify(text)}`;
  if (!TEXT_ATTR_RE.test(raw)) {
    throw new WriteError(
      "setTextOnDirective: directive is missing required text attribute",
      500
    );
  }
  return raw.replace(TEXT_ATTR_RE, replacement);
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
  const idx = raw.search(REPLIES_ATTR_RE);
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
  const m = raw.match(TRAILING_WHITESPACE_RE);
  const content = m ? m[1] : raw;
  const trail = m ? m[2] : "";
  const sep = content.length > 0 && !TRAILING_SPACE_RE.test(content) ? " " : "";
  return `${content}${sep}${serialized}${trail}`;
}

function readRepliesFromDirective(raw: string): StoredCommentReply[] {
  const idx = raw.search(REPLIES_ATTR_RE);
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

function skipQuotedString(source: string, start: number): number {
  const q = source.charAt(start);
  if (q !== '"' && q !== "'") {
    return start;
  }
  let j = start + 1;
  while (j < source.length) {
    if (source[j] === "\\") {
      j += 2;
      continue;
    }
    if (source[j] === q) {
      return j + 1;
    }
    j++;
  }
  return j;
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
      j = skipQuotedString(source, j);
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
  const ast = parseSourceAst(source);

  let mutated = false;
  forEachCommentBlock(ast, ({ block }) => {
    if (mutated) {
      return false;
    }
    const idMatch = block.value.match(COMMENT_ID_ATTR_RE);
    if (idMatch?.[1] !== commentId) {
      return;
    }
    block.value = mutate(block.value);
    mutated = true;
    return false;
  });

  if (!mutated) {
    throw new WriteError(
      `no @comment with id="${commentId}" found in ${absolutePath}`,
      404
    );
  }

  const output = printAst(ast);
  assertValidTsx(output, operationName);

  await atomicWrite(absolutePath, output);
}

export async function atomicWrite(
  absolutePath: string,
  content: string
): Promise<void> {
  try {
    await atomicWriteText(absolutePath, content);
  } catch (err) {
    throw new WriteError(
      `failed to write file (tmpdir=${tmpdir()}): ${errorMessage(err)}`,
      500
    );
  }
}
