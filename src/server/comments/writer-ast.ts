import * as t from "@babel/types";
import recast from "recast";
import babelTsParser from "recast/parsers/babel-ts.js";
import { WriteError } from "./writer-errors.ts";

export function pushComments(
  list: readonly t.Comment[] | null | undefined,
  out: t.Comment[]
): void {
  if (!list) {
    return;
  }
  for (const c of list) {
    out.push(c);
  }
}

/**
 * Find the JSXElement whose `loc.start` is at (line, column - 1). Babel
 * columns are 0-indexed; the overlay sends 1-indexed values matching the
 * `<` token, so we subtract 1 when matching.
 *
 * If no exact match exists, fall back to the JSXElement on the same line
 * with the smallest column delta — this forgives an off-by-one in either
 * direction (e.g. a caller that already converted).
 */
export function findJsxElementAt(
  ast: t.File,
  line: number,
  column: number
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
      return;
    },
  });

  if (exact) {
    return exact;
  }
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

/**
 * Find the JSXElement carrying `data-comment-anchor="<anchorUuid>"`. Mirrors
 * `findJsxElementAt` but matches on attribute value instead of source loc.
 */
export function findJsxElementByAnchor(
  ast: t.File,
  anchorUuid: string
): t.JSXElement | null {
  let found: t.JSXElement | null = null;
  recast.visit(ast, {
    visitJSXElement(jsxPath) {
      if (found) {
        return false;
      }
      const node = jsxPath.node as t.JSXElement;
      const v = readAttrValue(node.openingElement, "data-comment-anchor");
      if (v === anchorUuid) {
        found = node;
        return false;
      }
      this.traverse(jsxPath);
      return;
    },
  });
  return found;
}

export function readAttrValue(
  opening: t.JSXOpeningElement,
  name: string
): string | null {
  for (const attr of opening.attributes) {
    if (attr.type !== "JSXAttribute") {
      continue;
    }
    if (attr.name.type !== "JSXIdentifier") {
      continue;
    }
    if (attr.name.name !== name) {
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

export function addAttribute(
  opening: t.JSXOpeningElement,
  name: string,
  value: string
): void {
  opening.attributes.push(
    t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value))
  );
}

interface MarkerArgs {
  anchor: string;
  author: string;
  date: string;
  id: string;
  route?: string;
  /**
   * Optional repo-root absolute path to the saved screenshot, e.g.
   * `/designs/iterations/<id>/v0.png`. Emitted as `screenshot="..."` on the
   * directive when present.
   */
  screenshot?: string;
  text: string;
}

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
export function buildCommentMarker(args: MarkerArgs): t.JSXExpressionContainer {
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
      500
    );
  }
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
export function buildMarkerFromInner(
  directiveInner: string
): t.JSXExpressionContainer {
  // The directive must not contain "*/" (would close the block early). If it
  // does, the original source was malformed — bail rather than emit broken JS.
  if (directiveInner.includes("*/")) {
    throw new WriteError(
      "injectExistingMarkerIntoSource: directive contains '*/' (would close block early)",
      500
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
      500
    );
  }
  return found;
}

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
export function insertAfterSibling(
  ast: t.File,
  target: t.JSXElement,
  marker: t.JSXExpressionContainer
): void {
  let inserted = false;

  recast.visit(ast, {
    visitJSXElement(jsxPath) {
      if (inserted) {
        return false;
      }
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
      return;
    },
  });

  if (inserted) {
    return;
  }

  // Fallback: target has no JSXElement/JSXFragment parent (it's the root of
  // a function return, a conditional consequent, a map callback body, etc.).
  // Wrap the target in a JSX Fragment and place the marker as a sibling
  // within. This works for any JSXElement including self-closing ones, and
  // preserves the original target's formatting.
  recast.visit(ast, {
    visitJSXElement(jsxPath) {
      if (inserted) {
        return false;
      }
      const node = jsxPath.node as t.JSXElement;
      if (node !== target) {
        this.traverse(jsxPath);
        return;
      }
      const col = target.loc?.start.column ?? 0;
      const indent = " ".repeat(col);
      const outerIndent = " ".repeat(Math.max(0, col - 2));
      // Strip recast/babel's "parenthesized" trivia from the target. The parens
      // belong to the original return-expression context; carrying them into
      // the new fragment slot prints `(<label>…</label>)` which is valid JSX
      // but ugly.
      const targetExtra = (
        target as unknown as { extra?: Record<string, unknown> }
      ).extra;
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
        ]
      );
      jsxPath.replace(fragment);
      inserted = true;
      return false;
    },
  });

  if (!inserted) {
    throw new WriteError(
      "couldn't locate target JSXElement to wrap with marker",
      500
    );
  }
}

/**
 * Remove the `data-comment-anchor="<anchorUuid>"` attribute from whichever
 * JSXOpeningElement carries it. Returns true when a match was found and
 * stripped. Used by deleteCommentMarker after confirming the anchor has no
 * remaining references.
 */
export function stripAnchorAttribute(ast: t.File, anchorUuid: string): boolean {
  let stripped = false;
  recast.visit(ast, {
    visitJSXOpeningElement(p) {
      if (stripped) {
        return false;
      }
      const opening = p.node as t.JSXOpeningElement;
      const idx = opening.attributes.findIndex((attr) => {
        if (attr.type !== "JSXAttribute") {
          return false;
        }
        if (attr.name.type !== "JSXIdentifier") {
          return false;
        }
        if (attr.name.name !== "data-comment-anchor") {
          return false;
        }
        const v = attr.value;
        if (!v) {
          return false;
        }
        if (v.type === "StringLiteral") {
          return v.value === anchorUuid;
        }
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
      return;
    },
  });
  return stripped;
}

/**
 * Infer the indentation to use for a new sibling inserted at `idx + 1`. We
 * look at the JSXText that precedes the target — that node's last line is
 * the whitespace used to indent the target itself, so reusing it puts the
 * new sibling at the same column.
 */
function inferSiblingIndent(
  parent: t.JSXElement | t.JSXFragment,
  children: readonly t.Node[],
  targetIdx: number
): string {
  for (let i = targetIdx - 1; i >= 0; i--) {
    const child = children[i];
    if (child && child.type === "JSXText") {
      const raw = child.value;
      const nl = raw.lastIndexOf("\n");
      if (nl >= 0) {
        const indent = raw.slice(nl + 1);
        if (/^[ \t]*$/.test(indent)) {
          return indent;
        }
      }
    }
  }
  const col = parent.loc?.start.column ?? 0;
  return " ".repeat(col + 2);
}

export function isJsxParent(
  v: unknown
): v is { children: t.Node[] } & (t.JSXElement | t.JSXFragment) {
  if (!v || typeof v !== "object") {
    return false;
  }
  const node = v as { type?: string; children?: unknown };
  return (
    (node.type === "JSXElement" || node.type === "JSXFragment") &&
    Array.isArray(node.children)
  );
}
