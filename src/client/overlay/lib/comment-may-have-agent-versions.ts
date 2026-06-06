import type { CommentData } from "../../types.ts";

/**
 * Whether the @comment marker suggests fix variants (v > 0) may exist on
 * disk. Used to skip the versions skeleton when opening a comment-only thread.
 */
export function commentMayHaveFixVersions(
  lead: Pick<CommentData, "active" | "replies">
): boolean {
  if ((lead.active ?? 0) > 0) {
    return true;
  }
  return (lead.replies ?? []).some((reply) => reply.v !== undefined);
}
