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
  setResolvedOnDirective,
  setTextOnDirective,
  updateReplyOnDirective,
} from "./writer-directive.ts";
import { WriteError } from "./writer-errors.ts";

const COMMENT_ID_ATTR_RE = /\bid="([^"]+)"/;
const ANCHOR_ATTR_RE = /\banchor="([^"]+)"/;
const TRAILING_NEWLINE_INDENT_RE = /\n[ \t]*$/;

export interface WriteCommentInput {
  absolutePath: string;
  author: string;
  column: number;
  existingAnchor?: string;
  id?: string;
  line: number;
  route?: string;
  screenshot?: string;
  text: string;
}

export interface WriteCommentResult {
  anchor: string;
  date: string;
  id: string;
}

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

  const existingAnchorOnNode = readAttrValue(
    target.openingElement,
    "data-comment-anchor"
  );
  const anchorUuid =
    existingAnchorOnNode ?? input.existingAnchor ?? randomUUID();
  if (!existingAnchorOnNode) {
    addAttribute(target.openingElement, "data-comment-anchor", anchorUuid);
  }

  const id = input.id ?? randomUUID();
  const date = new Date().toISOString();

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
      `generated output failed to re-parse: ${message}`,
      500
    );
  }

  await atomicWrite(input.absolutePath, output);

  return { id, anchor: anchorUuid, date };
}

export interface UpdateCommentActiveInput {
  absolutePath: string;
  active: number;
  commentId: string;
}

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
  absolutePath: string;
  commentId: string;
  text: string;
}

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

export interface UpdateCommentResolvedInput {
  absolutePath: string;
  commentId: string;
  resolved: boolean;
}

export async function updateCommentResolved(
  input: UpdateCommentResolvedInput
): Promise<void> {
  await mutateCommentDirectiveById(
    input.absolutePath,
    input.commentId,
    (raw) => setResolvedOnDirective(raw, input.resolved),
    "updateCommentResolved"
  );
}

export interface AppendCommentReplyInput {
  absolutePath: string;
  commentId: string;
  reply: {
    author: string;
    text: string;
    v?: number;
  };
}

export interface AppendCommentReplyResult {
  author: string;
  date: string;
  text: string;
  v: number;
}

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
  replyIndex: number;
  text: string;
}

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
  replyIndex: number;
}

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
  absolutePath: string;
  commentId: string;
}

export interface DeleteCommentMarkerResult {
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

  const parent = targetParent as { children: t.Node[] };
  const children = parent.children;
  const removeFrom = targetIndex;
  let removeCount = 1;

  const prev = children[removeFrom - 1];
  if (prev && prev.type === "JSXText") {
    const text = (prev as t.JSXText).value;
    const stripped = text.replace(TRAILING_NEWLINE_INDENT_RE, "");
    if (stripped.length === 0) {
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
