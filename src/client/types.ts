export interface CommentReply {
  author: string;
  date: string;
  text: string;
  v?: number;
}

export interface CommentProps {
  active?: number;
  anchor: string;
  author: string;
  date: string;
  id: string;
  replies?: CommentReply[];
  resolved?: boolean;
  /**
   * App route (pathname + search + hash) where the comment was created.
   * Used by the list panel to navigate back to the page hosting the anchor.
   */
  route?: string;
  screenshot?: string;
  snapshot?: string;
  text: string;
}

/**
 * The shape consumed by the overlay UI. Identical to CommentProps plus the
 * `view` slug resolved at parse time by the Vite plugin (or undefined/null
 * when the comment isn't inside a `data-view` ancestor).
 */
export type CommentData = CommentProps & {
  view?: string | null;
};

/** Alias for `CommentData`; kept for backwards-compatible imports. */
export type RegisteredComment = CommentData;
