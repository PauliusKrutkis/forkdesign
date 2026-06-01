import type { CommentData, CommentReply } from "../../types.ts";

function mapComment(
  comments: CommentData[],
  id: string,
  update: (comment: CommentData) => CommentData
): CommentData[] {
  let changed = false;
  const next = comments.map((c) => {
    if (c.id !== id) {
      return c;
    }
    changed = true;
    return update(c);
  });
  return changed ? next : comments;
}

export function updateCommentText(
  comments: CommentData[],
  id: string,
  text: string
): CommentData[] {
  return mapComment(comments, id, (c) => ({ ...c, text }));
}

export function appendReply(
  comments: CommentData[],
  id: string,
  reply: CommentReply
): CommentData[] {
  return mapComment(comments, id, (c) => ({
    ...c,
    replies: [...(c.replies ?? []), reply],
  }));
}

function replyIndexInBounds(
  comments: CommentData[],
  id: string,
  replyIndex: number
): boolean {
  const c = comments.find((x) => x.id === id);
  const replies = c?.replies ?? [];
  return replyIndex >= 0 && replyIndex < replies.length;
}

export function updateReply(
  comments: CommentData[],
  id: string,
  replyIndex: number,
  text: string
): CommentData[] {
  if (!replyIndexInBounds(comments, id, replyIndex)) {
    return comments;
  }
  return mapComment(comments, id, (c) => {
    const replies = c.replies ?? [];
    const nextReplies = replies.map((r, i) =>
      i === replyIndex ? { ...r, text } : r
    );
    return { ...c, replies: nextReplies };
  });
}

export function removeReply(
  comments: CommentData[],
  id: string,
  replyIndex: number
): CommentData[] {
  if (!replyIndexInBounds(comments, id, replyIndex)) {
    return comments;
  }
  return mapComment(comments, id, (c) => {
    const replies = c.replies ?? [];
    const nextReplies = replies.filter((_, i) => i !== replyIndex);
    return { ...c, replies: nextReplies.length > 0 ? nextReplies : undefined };
  });
}

export function removeComment(
  comments: CommentData[],
  id: string
): CommentData[] {
  return comments.filter((c) => c.id !== id);
}

export function toggleCommentResolved(
  comments: CommentData[],
  id: string,
  resolved: boolean
): CommentData[] {
  return mapComment(comments, id, (c) => ({ ...c, resolved }));
}
