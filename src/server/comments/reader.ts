/**
 * Read `{/* @comment ... *\/}` markers from TSX source. Malformed markers are
 * skipped so the writer never round-trips a half-resolved value.
 */
import { readFile } from "node:fs/promises";
import { parse } from "@babel/parser";
import _traverse, { type NodePath } from "@babel/traverse";
import type {
  Comment as BabelComment,
  JSXElement,
  JSXExpressionContainer,
  JSXOpeningElement,
  Node,
} from "@babel/types";
import type { CommentProps, CommentReply } from "../../client/types.ts";
import {
  isSafeIterationScreenshotPath,
  isSafePathSegment,
} from "../platform/path-safety.ts";

const WHITESPACE_CHAR_RE = /\s/;
const ATTR_KEY_CHAR_RE = /[A-Za-z0-9_-]/;
const INTEGER_TOKEN_RE = /^-?[0-9]+$/;
const HEX4_RE = /^[0-9a-fA-F]{4}$/;

// @babel/traverse is published as CJS; under ESM `import x from` may resolve to
// `{ default: fn }` depending on bundler interop. Normalize both shapes.
type TraverseFn = typeof _traverse;
const traverse: TraverseFn =
  (_traverse as unknown as { default?: TraverseFn }).default ?? _traverse;

/**
 * The shape of one entry returned by GET /api/comments. Extends CommentProps
 * with the inferred `view` slug (or null if no `data-view` ancestor was found).
 */
type ReadComment = CommentProps & {
  view: string | null;
};

export interface ReadResult {
  comments: ReadComment[];
  warnings: string[];
}

/**
 * Read a .tsx file from disk and return the list of comment-block markers it
 * contains plus any warnings encountered.
 */
export async function readCommentsFromFile(
  absolutePath: string
): Promise<ReadResult> {
  const source = await readFile(absolutePath, "utf8");
  return readCommentsFromSource(source);
}

export function readCommentsFromSource(source: string): ReadResult {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
    errorRecovery: false,
    // Comments are attached by default, but be explicit.
    attachComment: true,
  });

  const comments: ReadComment[] = [];
  const warnings: string[] = [];
  // Avoid double-counting if the same CommentBlock somehow appears under more
  // than one container in the AST.
  const seenComments = new Set<BabelComment>();

  traverse(ast, {
    JSXExpressionContainer(path: NodePath<JSXExpressionContainer>) {
      const expr = path.node.expression;
      if (expr.type !== "JSXEmptyExpression") {
        return;
      }

      // Block comments attached to `{/* … */}` may land on either the
      // JSXEmptyExpression (innerComments) or its container's leading slot
      // depending on the parser version. Check both.
      const blocks: BabelComment[] = [];
      collectCommentBlocks(expr.innerComments, blocks, seenComments);
      collectCommentBlocks(expr.leadingComments, blocks, seenComments);
      collectCommentBlocks(expr.trailingComments, blocks, seenComments);

      if (blocks.length === 0) {
        return;
      }

      const view = resolveViewFromAncestors(path);

      for (const block of blocks) {
        const raw = block.value;
        const trimmed = raw.trim();
        if (!trimmed.startsWith("@comment")) {
          continue;
        }
        const parsed = parseDirective(trimmed, warnings, block);
        if (parsed) {
          comments.push({ ...parsed, view });
        }
      }
    },
  });

  return { comments, warnings };
}

function collectCommentBlocks(
  list: readonly BabelComment[] | null | undefined,
  out: BabelComment[],
  seen: Set<BabelComment>
): void {
  if (!list) {
    return;
  }
  for (const c of list) {
    if (c.type !== "CommentBlock") {
      continue;
    }
    if (seen.has(c)) {
      continue;
    }
    seen.add(c);
    out.push(c);
  }
}

// ---------------------------------------------------------------------------
// Directive parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single `@comment id="..." anchor="..." text="..." ...` directive
 * out of the raw CommentBlock value. Returns null and pushes a warning when
 * required fields are missing or attribute syntax is malformed.
 */
function parseDirective(
  trimmed: string,
  warnings: string[],
  block: BabelComment
): CommentProps | null {
  // Strip the leading marker.
  const body = trimmed.slice("@comment".length).trim();
  const attrs = parseAttributes(body, warnings, block);
  if (!attrs) {
    return null;
  }

  const id = stringOf(attrs.values.id);
  const text = stringOf(attrs.values.text);
  const author = stringOf(attrs.values.author);
  const date = stringOf(attrs.values.date);
  const anchor = stringOf(attrs.values.anchor);

  const tag = `@comment id=${id ?? "?"}`;
  const line = block.loc?.start.line ?? "?";

  if (
    id === null ||
    text === null ||
    author === null ||
    date === null ||
    anchor === null
  ) {
    warnings.push(
      `${tag} skipped: missing required attribute(s) ${describeMissing({ id, text, author, date, anchor })} (line ${line})`
    );
    return null;
  }

  if (!isSafePathSegment(id)) {
    warnings.push(`${tag} skipped: invalid id (line ${line})`);
    return null;
  }

  const rawScreenshot = stringOf(attrs.values.screenshot) ?? undefined;
  const screenshot =
    rawScreenshot && isSafeIterationScreenshotPath(rawScreenshot)
      ? rawScreenshot
      : undefined;
  if (rawScreenshot && !screenshot) {
    warnings.push(`${tag}: ignored invalid screenshot path (line ${line})`);
  }
  const snapshot = stringOf(attrs.values.snapshot) ?? undefined;
  const resolved = boolOf(attrs.values.resolved) ?? false;
  const replies = arrayOf(attrs.values.replies, warnings, tag) ?? [];
  const active = numberOf(attrs.values.active);
  const route = stringOf(attrs.values.route) ?? undefined;

  return {
    id,
    text,
    author,
    date,
    anchor,
    screenshot,
    snapshot,
    resolved,
    replies,
    ...(active === null ? {} : { active }),
    ...(route ? { route } : {}),
  };
}

type AttrValue =
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "array"; value: unknown }
  | { kind: "number"; value: number };

interface ParsedAttrs {
  values: Partial<Record<string, AttrValue>>;
}

function skipAttrWhitespace(source: string, start: number): number {
  const len = source.length;
  let pos = start;
  while (pos < len && WHITESPACE_CHAR_RE.test(source.charAt(pos))) {
    pos++;
  }
  return pos;
}

function readAttrKey(
  source: string,
  start: number,
  warnings: string[],
  line: string | number
): { key: string; next: number } | null {
  const len = source.length;
  const keyStart = start;
  let pos = start;
  while (pos < len && ATTR_KEY_CHAR_RE.test(source.charAt(pos))) {
    pos++;
  }
  if (pos === keyStart) {
    warnings.push(
      `@comment skipped: unexpected character '${source[pos]}' (line ${line})`
    );
    return null;
  }
  return { key: source.slice(keyStart, pos), next: pos };
}

function parseQuotedAttrValue(
  source: string,
  i: number,
  key: string,
  warnings: string[],
  line: string | number
): { value: AttrValue; next: number } | null {
  const r = readDoubleQuotedString(source, i);
  if (!r) {
    warnings.push(
      `@comment skipped: unterminated string for '${key}' (line ${line})`
    );
    return null;
  }
  return { value: { kind: "string", value: r.value }, next: r.next };
}

function parseArrayAttrValue(
  source: string,
  i: number,
  key: string,
  warnings: string[],
  line: string | number
): { value: AttrValue; next: number } | null {
  const r = readBalanced(source, i, "[", "]");
  if (!r) {
    warnings.push(
      `@comment skipped: unbalanced [] for '${key}' (line ${line})`
    );
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.slice);
  } catch (err) {
    warnings.push(
      `@comment skipped: invalid JSON array for '${key}': ${err instanceof Error ? err.message : String(err)} (line ${line})`
    );
    return null;
  }
  return { value: { kind: "array", value: parsed }, next: r.next };
}

function parseBareIntegerAttrValue(
  source: string,
  start: number,
  key: string,
  warnings: string[],
  line: string | number,
  values: Record<string, AttrValue>
): number | null {
  const len = source.length;
  const tokStart = start;
  let pos = start;
  while (pos < len && !WHITESPACE_CHAR_RE.test(source.charAt(pos))) {
    pos++;
  }
  const token = source.slice(tokStart, pos);
  if (token.length === 0) {
    warnings.push(
      `@comment skipped: unsupported value for '${key}' (line ${line})`
    );
    return null;
  }
  if (!INTEGER_TOKEN_RE.test(token)) {
    warnings.push(
      `@comment '${key}': expected an integer, got '${token}' — skipping attribute (line ${line})`
    );
    return pos;
  }
  const n = Number.parseInt(token, 10);
  if (Number.isNaN(n)) {
    warnings.push(
      `@comment '${key}': failed to parse integer '${token}' — skipping attribute (line ${line})`
    );
    return pos;
  }
  values[key] = { kind: "number", value: n };
  return pos;
}

function parseAssignedAttrValue(
  source: string,
  i: number,
  key: string,
  warnings: string[],
  line: string | number,
  values: Record<string, AttrValue>
): number | null {
  const len = source.length;
  if (i >= len) {
    warnings.push(
      `@comment skipped: trailing '=' for key '${key}' (line ${line})`
    );
    return null;
  }
  const ch = source[i];
  if (ch === '"') {
    const parsed = parseQuotedAttrValue(source, i, key, warnings, line);
    if (!parsed) {
      return null;
    }
    values[key] = parsed.value;
    return parsed.next;
  }
  if (ch === "[") {
    const parsed = parseArrayAttrValue(source, i, key, warnings, line);
    if (!parsed) {
      return null;
    }
    values[key] = parsed.value;
    return parsed.next;
  }
  if (source.startsWith("true", i)) {
    values[key] = { kind: "boolean", value: true };
    return i + 4;
  }
  if (source.startsWith("false", i)) {
    values[key] = { kind: "boolean", value: false };
    return i + 5;
  }
  return parseBareIntegerAttrValue(source, i, key, warnings, line, values);
}

function parseOneAttribute(
  source: string,
  start: number,
  warnings: string[],
  line: string | number,
  values: Record<string, AttrValue>
): number | null {
  const len = source.length;
  let pos = skipAttrWhitespace(source, start);
  if (pos >= len) {
    return pos;
  }

  const keyResult = readAttrKey(source, pos, warnings, line);
  if (!keyResult) {
    return null;
  }
  const { key } = keyResult;
  pos = keyResult.next;

  if (pos < len && source[pos] === "=") {
    return parseAssignedAttrValue(source, pos + 1, key, warnings, line, values);
  }
  values[key] = { kind: "boolean", value: true };
  return pos;
}

/**
 * Tiny attribute parser. Recognized forms:
 *
 *   key="..."            — double-quoted string with `\"` and `\\` escapes
 *                          and standard JSON escape sequences (\n, \t, ...)
 *   key=true|false       — boolean literal
 *   key                  — bare flag, equivalent to `key=true`
 *   key=[ ... ]          — array literal; the bracketed payload is handed off
 *                          to JSON.parse for replies-style arrays. Square
 *                          brackets must balance.
 *
 * Whitespace between attributes is required. Unknown keys are kept; the caller
 * decides which keys are meaningful.
 */
function parseAttributes(
  source: string,
  warnings: string[],
  block: BabelComment
): ParsedAttrs | null {
  const values: Record<string, AttrValue> = {};
  const line = block.loc?.start.line ?? "?";
  let i = 0;
  const len = source.length;

  while (i < len) {
    const next = parseOneAttribute(source, i, warnings, line, values);
    if (next === null) {
      return null;
    }
    if (next >= len) {
      break;
    }
    i = next;
  }

  return { values };
}

/**
 * Read a JSON-style double-quoted string starting at `source[i]` (the opening
 * quote). Supports `\"`, `\\`, `\n`, `\r`, `\t`, `\b`, `\f`, `\/`, and `\uXXXX`.
 */
function readDoubleQuotedString(
  source: string,
  i: number
): { value: string; next: number } | null {
  if (source[i] !== '"') {
    return null;
  }
  let j = i + 1;
  let out = "";
  const len = source.length;
  while (j < len) {
    const c = source[j];
    if (c === '"') {
      return { value: out, next: j + 1 };
    }
    if (c === "\\") {
      const n = source[j + 1];
      if (n === undefined) {
        return null;
      }
      switch (n) {
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "/":
          out += "/";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "u": {
          const hex = source.slice(j + 2, j + 6);
          if (!HEX4_RE.test(hex)) {
            return null;
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          j += 4;
          break;
        }
        default:
          // Unknown escape: keep the next char verbatim.
          out += n;
      }
      j += 2;
      continue;
    }
    out += c;
    j++;
  }
  return null;
}

/**
 * Scan from `source[i]` (the `open` char) until the matching `close`,
 * respecting strings (so brackets inside quoted strings don't unbalance).
 */
function readBalanced(
  source: string,
  i: number,
  open: string,
  close: string
): { slice: string; next: number } | null {
  if (source[i] !== open) {
    return null;
  }
  let depth = 0;
  let j = i;
  const len = source.length;
  while (j < len) {
    const c = source[j];
    if (c === '"') {
      const r = readDoubleQuotedString(source, j);
      if (!r) {
        return null;
      }
      j = r.next;
      continue;
    }
    if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) {
        return { slice: source.slice(i, j + 1), next: j + 1 };
      }
    }
    j++;
  }
  return null;
}

function stringOf(v: AttrValue | undefined): string | null {
  if (v?.kind !== "string") {
    return null;
  }
  return v.value;
}

function numberOf(v: AttrValue | undefined): number | null {
  if (v?.kind !== "number") {
    return null;
  }
  return v.value;
}

function boolOf(v: AttrValue | undefined): boolean | null {
  if (!v) {
    return null;
  }
  if (v.kind === "boolean") {
    return v.value;
  }
  if (v.kind === "string") {
    if (v.value === "true") {
      return true;
    }
    if (v.value === "false") {
      return false;
    }
  }
  return null;
}

function arrayOf(
  v: AttrValue | undefined,
  warnings: string[],
  tag: string
): CommentReply[] | null {
  if (!v) {
    return null;
  }
  if (v.kind !== "array") {
    warnings.push(`${tag} replies: not an array, ignored`);
    return null;
  }
  const raw = v.value;
  if (!Array.isArray(raw)) {
    warnings.push(`${tag} replies: not an array literal, ignored`);
    return null;
  }
  const out: CommentReply[] = [];
  for (const el of raw) {
    if (!el || typeof el !== "object") {
      warnings.push(`${tag} replies: non-object element, ignored`);
      continue;
    }
    const obj = el as Record<string, unknown>;
    if (
      typeof obj.author === "string" &&
      typeof obj.date === "string" &&
      typeof obj.text === "string"
    ) {
      const reply: CommentReply = {
        author: obj.author,
        date: obj.date,
        text: obj.text,
      };
      if (typeof obj.v === "number" && Number.isInteger(obj.v) && obj.v >= 0) {
        reply.v = obj.v;
      } else if (obj.v !== undefined) {
        warnings.push(`${tag} replies: reply has invalid v, ignored`);
      }
      out.push(reply);
    } else {
      warnings.push(`${tag} replies: reply missing author/date/text, ignored`);
    }
  }
  return out;
}

function describeMissing(values: Record<string, string | null>): string {
  return Object.entries(values)
    .filter(([, v]) => v === null)
    .map(([k]) => k)
    .join(", ");
}

// ---------------------------------------------------------------------------
// View resolution
// ---------------------------------------------------------------------------

/**
 * Walk JSXElement ancestors from the JSXExpressionContainer outward, returning
 * the first static `data-view="<slug>"` attribute encountered.
 */
function resolveViewFromAncestors(
  path: NodePath<JSXExpressionContainer>
): string | null {
  let current: NodePath<Node> | null = path.parentPath;
  while (current) {
    if (current.isJSXElement()) {
      const slug = getDataViewAttr((current.node as JSXElement).openingElement);
      if (slug !== null) {
        return slug;
      }
    }
    current = current.parentPath;
  }
  return null;
}

function getDataViewAttr(opening: JSXOpeningElement): string | null {
  for (const attr of opening.attributes) {
    if (attr.type !== "JSXAttribute") {
      continue;
    }
    if (attr.name.type !== "JSXIdentifier") {
      continue;
    }
    if (attr.name.name !== "data-view") {
      continue;
    }
    const v = attr.value;
    if (!v) {
      return null;
    }
    if (v.type === "StringLiteral") {
      return v.value;
    }
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
