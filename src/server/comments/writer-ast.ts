import type {
  Comment,
  File,
  JSXElement,
  JSXExpressionContainer,
  JSXFragment,
  JSXOpeningElement,
  Node,
} from "@babel/types";
import {
  jsxAttribute,
  jsxClosingFragment,
  jsxFragment,
  jsxIdentifier,
  jsxOpeningFragment,
  jsxText,
  stringLiteral,
} from "@babel/types";
import recast from "recast";
import babelTsParser from "recast/parsers/babel-ts.js";
import { WriteError } from "./writer-errors.ts";

const INDENT_ONLY_RE = /^[ \t]*$/;
const COMMENT_ID_ATTR_RE = /\bid="([^"]+)"/;
const JSX_WHITESPACE_RE = /^\s*$/;

export function pushComments(
  list: readonly Comment[] | null | undefined,
  out: Comment[]
): void {
  if (!list) {
    return;
  }
  for (const c of list) {
    out.push(c);
  }
}

export function findJsxElementAt(
  ast: File,
  line: number,
  column: number
): JSXElement | null {
  const targetCol = column - 1;
  let exact: JSXElement | null = null;
  let bestFallback: { node: JSXElement; delta: number } | null = null;

  recast.visit(ast, {
    visitJSXElement(jsxPath) {
      const node = jsxPath.node as JSXElement;
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
  if (bestFallback !== null) {
    const fb = bestFallback as { node: JSXElement; delta: number };
    if (fb.delta <= 1) {
      return fb.node;
    }
  }
  return null;
}

export function findJsxElementByAnchor(
  ast: File,
  anchorUuid: string
): JSXElement | null {
  let found: JSXElement | null = null;
  recast.visit(ast, {
    visitJSXElement(jsxPath) {
      if (found) {
        return false;
      }
      const node = jsxPath.node as JSXElement;
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

export function findJsxElementByCommentMarker(
  ast: File,
  commentId: string
): JSXElement | null {
  let found: JSXElement | null = null;
  recast.visit(ast, {
    visitJSXExpressionContainer(jsxPath) {
      if (found) {
        return false;
      }
      const node = jsxPath.node as JSXExpressionContainer;
      if (!isCommentMarkerForId(node, commentId)) {
        this.traverse(jsxPath);
        return;
      }

      let parent = jsxPath.parent;
      while (parent) {
        const parentNode = parent.value as unknown;
        if (isJsxParent(parentNode)) {
          const idx = parentNode.children.indexOf(node);
          if (idx >= 0) {
            found = previousJsxElementSibling(parentNode.children, idx);
            return false;
          }
        }
        parent = parent.parent;
      }
      return false;
    },
  });
  return found;
}

export function readAttrValue(
  opening: JSXOpeningElement,
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

function isCommentMarkerForId(
  node: JSXExpressionContainer,
  commentId: string
): boolean {
  if (node.expression.type !== "JSXEmptyExpression") {
    return false;
  }
  const blocks: Comment[] = [];
  pushComments(node.innerComments, blocks);
  pushComments(node.leadingComments, blocks);
  pushComments(node.trailingComments, blocks);
  pushComments(node.expression.innerComments, blocks);
  pushComments(node.expression.leadingComments, blocks);
  pushComments(node.expression.trailingComments, blocks);
  return blocks.some((block) => {
    if (block.type !== "CommentBlock") {
      return false;
    }
    if (!block.value.trim().startsWith("@comment")) {
      return false;
    }
    return block.value.match(COMMENT_ID_ATTR_RE)?.[1] === commentId;
  });
}

function previousJsxElementSibling(
  children: readonly Node[],
  markerIndex: number
): JSXElement | null {
  for (let i = markerIndex - 1; i >= 0; i--) {
    const child = children[i];
    if (!child) {
      continue;
    }
    if (child.type === "JSXText" && JSX_WHITESPACE_RE.test(child.value)) {
      continue;
    }
    return child.type === "JSXElement" ? child : null;
  }
  return null;
}

export function addAttribute(
  opening: JSXOpeningElement,
  name: string,
  value: string
): void {
  opening.attributes.push(
    jsxAttribute(jsxIdentifier(name), stringLiteral(value))
  );
}

interface MarkerArgs {
  anchor: string;
  author: string;
  date: string;
  id: string;
  route?: string;
  screenshot?: string;
  text: string;
}

export function buildCommentMarker(args: MarkerArgs): JSXExpressionContainer {
  const directive =
    `@comment id="${args.id}" anchor="${args.anchor}"` +
    ` text=${JSON.stringify(args.text)} author=${JSON.stringify(args.author)}` +
    ` date="${args.date}"` +
    (args.screenshot ? ` screenshot="${args.screenshot}"` : "") +
    (args.route ? ` route=${JSON.stringify(args.route)}` : "");

  const wrap = `<>{/* ${directive} */}</>;`;
  const wrapped = recast.parse(wrap, { parser: babelTsParser }) as File;

  let found: JSXExpressionContainer | null = null;
  recast.visit(wrapped, {
    visitJSXExpressionContainer(p) {
      found = p.node as JSXExpressionContainer;
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

export function buildMarkerFromInner(
  directiveInner: string
): JSXExpressionContainer {
  if (directiveInner.includes("*/")) {
    throw new WriteError(
      "injectExistingMarkerIntoSource: directive contains '*/' (would close block early)",
      500
    );
  }
  const wrap = `<>{/*${directiveInner}*/}</>;`;
  const wrapped = recast.parse(wrap, { parser: babelTsParser }) as File;
  let found: JSXExpressionContainer | null = null;
  recast.visit(wrapped, {
    visitJSXExpressionContainer(p) {
      found = p.node as JSXExpressionContainer;
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

export function insertAfterSibling(
  ast: File,
  target: JSXElement,
  marker: JSXExpressionContainer
): void {
  let inserted = false;

  recast.visit(ast, {
    visitJSXElement(jsxPath) {
      if (inserted) {
        return false;
      }
      const node = jsxPath.node as JSXElement;
      if (node === target) {
        let p = jsxPath.parent;
        while (p) {
          const parentNode = p.value as unknown;
          if (isJsxParent(parentNode)) {
            const children = parentNode.children;
            const idx = children.indexOf(target);
            if (idx >= 0) {
              const indent = inferSiblingIndent(parentNode, children, idx);
              const whitespace = jsxText(`\n${indent}`);
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

  recast.visit(ast, {
    visitJSXElement(jsxPath) {
      if (inserted) {
        return false;
      }
      const node = jsxPath.node as JSXElement;
      if (node !== target) {
        this.traverse(jsxPath);
        return;
      }
      const col = target.loc?.start.column ?? 0;
      const indent = " ".repeat(col);
      const outerIndent = " ".repeat(Math.max(0, col - 2));
      const targetExtra = (
        target as unknown as { extra?: Record<string, unknown> }
      ).extra;
      if (targetExtra && "parenthesized" in targetExtra) {
        targetExtra.parenthesized = false;
        targetExtra.parenStart = undefined;
      }
      const fragment = jsxFragment(jsxOpeningFragment(), jsxClosingFragment(), [
        jsxText(`\n${indent}`),
        target,
        jsxText(`\n${indent}`),
        marker,
        jsxText(`\n${outerIndent}`),
      ]);
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

export function stripAnchorAttribute(ast: File, anchorUuid: string): boolean {
  let stripped = false;
  recast.visit(ast, {
    visitJSXOpeningElement(p) {
      if (stripped) {
        return false;
      }
      const opening = p.node as JSXOpeningElement;
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

function inferSiblingIndent(
  parent: JSXElement | JSXFragment,
  children: readonly Node[],
  targetIdx: number
): string {
  for (let i = targetIdx - 1; i >= 0; i--) {
    const child = children[i];
    if (child && child.type === "JSXText") {
      const raw = child.value;
      const nl = raw.lastIndexOf("\n");
      if (nl >= 0) {
        const indent = raw.slice(nl + 1);
        if (INDENT_ONLY_RE.test(indent)) {
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
): v is { children: Node[] } & (JSXElement | JSXFragment) {
  if (!v || typeof v !== "object") {
    return false;
  }
  const node = v as { type?: string; children?: unknown };
  return (
    (node.type === "JSXElement" || node.type === "JSXFragment") &&
    Array.isArray(node.children)
  );
}
