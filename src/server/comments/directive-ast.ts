import { parse as parseBabel } from "@babel/parser";
import type * as t from "@babel/types";
import recast from "recast";
import babelTsParser from "recast/parsers/babel-ts.js";
import { errorMessage } from "../platform/errors.ts";
import { pushComments } from "./writer-ast.ts";
import { WriteError } from "./writer-errors.ts";

export const COMMENT_ID_ATTR_RE = /\bid="([^"]+)"/;

export type SourceFileAst = ReturnType<typeof recast.parse>;

export interface CommentBlockMatch {
  block: t.CommentBlock;
}

export function forEachCommentBlock(
  ast: SourceFileAst,
  fn: (match: CommentBlockMatch) => false | undefined
): void {
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
        if (fn({ block }) === false) {
          return false;
        }
      }
      this.traverse(p);
      return;
    },
  });
}

export function findCommentBlockById(
  ast: SourceFileAst,
  commentId: string
): CommentBlockMatch | null {
  let found: CommentBlockMatch | null = null;
  forEachCommentBlock(ast, ({ block }) => {
    const idMatch = block.value.match(COMMENT_ID_ATTR_RE);
    if (idMatch?.[1] === commentId) {
      found = { block };
      return false;
    }
  });
  return found;
}

export function assertValidTsx(source: string, context: string): void {
  try {
    parseBabel(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: false,
    });
  } catch (err) {
    throw new WriteError(
      `${context}: generated output failed to re-parse: ${errorMessage(err)}`,
      500
    );
  }
}

export function parseSourceAst(source: string): SourceFileAst {
  return recast.parse(source, { parser: babelTsParser });
}

export function printAst(ast: SourceFileAst): string {
  return recast.print(ast).code;
}
