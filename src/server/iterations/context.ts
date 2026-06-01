import {
  type FoundComment,
  findCommentById,
} from "../comments/find-comment.ts";
import { resolveIterationDirRoots } from "./manifest.ts";

export type CommentIterationContext =
  | {
      ok: true;
      found: FoundComment;
      iterationRoots: string[];
      /** Canonical iteration store (first root). */
      iterDir: string;
    }
  | { ok: false; status: number; message: string };

export async function resolveCommentIterationContext(
  projectRoot: string,
  id: string,
  excludePrefixes: string[]
): Promise<CommentIterationContext> {
  const found = await findCommentById(projectRoot, id, excludePrefixes);
  if (!found) {
    return { ok: false, status: 404, message: `comment id not found: ${id}` };
  }

  const iterationRoots = resolveIterationDirRoots(projectRoot, id);
  if (iterationRoots.length === 0) {
    return {
      ok: false,
      status: 404,
      message: `iterations dir not found: ${id}`,
    };
  }

  return {
    ok: true,
    found,
    iterationRoots,
    iterDir: iterationRoots[0],
  };
}
