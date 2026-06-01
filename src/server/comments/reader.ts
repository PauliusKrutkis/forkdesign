/**
 * AST reader for `{/* @comment ... *\/}` markers inside a `.tsx` page file.
 *
 * Used by the dev-only Vite plugin (`server/plugins/comments.ts`) to serve
 * `GET /api/comments`. Read path only — no writes, no caching.
 *
 * Scope (W4 read path):
 *   - Parse the file with @babel/parser (jsx + typescript) with `attachComment`.
 *   - Walk JSXExpressionContainer nodes whose expression is a JSXEmptyExpression
 *     carrying a CommentBlock whose text starts with `@comment`.
 *   - Extract a CommentProps object from the directive's attribute list.
 *   - Resolve `view` by walking parents to the nearest JSXElement that has a
 *     static `data-view="..."` attribute.
 *
 * Anything malformed (missing required fields, unparsable attributes) is
 * treated as a warning and skipped — dev tooling stays strict so we never
 * round-trip a half-resolved value.
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

  const screenshot = stringOf(attrs.values.screenshot) ?? undefined;
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
  let i = 0;
  const len = source.length;
  const line = block.loc?.start.line ?? "?";

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(source.charAt(i))) {
      i++;
    }
    if (i >= len) {
      break;
    }

    // Key
    const keyStart = i;
    while (i < len && /[A-Za-z0-9_-]/.test(source.charAt(i))) {
      i++;
    }
    if (i === keyStart) {
      warnings.push(
        `@comment skipped: unexpected character '${source[i]}' (line ${line})`
      );
      return null;
    }
    const key = source.slice(keyStart, i);

    // Optional `=value`
    if (i < len && source[i] === "=") {
      i++;
      if (i >= len) {
        warnings.push(
          `@comment skipped: trailing '=' for key '${key}' (line ${line})`
        );
        return null;
      }
      const ch = source[i];
      if (ch === '"') {
        const r = readDoubleQuotedString(source, i);
        if (!r) {
          warnings.push(
            `@comment skipped: unterminated string for '${key}' (line ${line})`
          );
          return null;
        }
        values[key] = { kind: "string", value: r.value };
        i = r.next;
      } else if (ch === "[") {
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
        values[key] = { kind: "array", value: parsed };
        i = r.next;
      } else if (source.startsWith("true", i)) {
        values[key] = { kind: "boolean", value: true };
        i += 4;
      } else if (source.startsWith("false", i)) {
        values[key] = { kind: "boolean", value: false };
        i += 5;
      } else {
        // Bare (unquoted) value. Read until whitespace, then try to interpret
        // it as an integer. This is how `active=N` works on the directive.
        // Anything that isn't a clean integer is soft-skipped: we emit a
        // warning and drop the attribute, but keep the rest of the comment.
        const tokStart = i;
        while (i < len && !/\s/.test(source.charAt(i))) {
          i++;
        }
        const token = source.slice(tokStart, i);
        if (token.length === 0) {
          warnings.push(
            `@comment skipped: unsupported value for '${key}' (line ${line})`
          );
          return null;
        }
        if (/^-?[0-9]+$/.test(token)) {
          const n = Number.parseInt(token, 10);
          if (Number.isNaN(n)) {
            warnings.push(
              `@comment '${key}': failed to parse integer '${token}' — skipping attribute (line ${line})`
            );
            continue;
          }
          values[key] = { kind: "number", value: n };
        } else {
          warnings.push(
            `@comment '${key}': expected an integer, got '${token}' — skipping attribute (line ${line})`
          );
        }
      }
    } else {
      // Bare flag.
      values[key] = { kind: "boolean", value: true };
    }
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
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
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
