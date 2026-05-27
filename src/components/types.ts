export type CommentReply = {
  author: string;
  /** ISO 8601 date string */
  date: string;
  text: string;
};

export type CommentProps = {
  /** uuid v4, matches data-comment-anchor on the target element */
  id: string;
  /** body text */
  text: string;
  /** author identifier (e.g. email) */
  author: string;
  /** ISO 8601 date string */
  date: string;
  /** uuid matching data-comment-anchor on the sibling/target element */
  anchor: string;
  /** repo-root absolute path to cropped PNG, e.g. /designs/runs-preview/comments/<uuid>.png */
  screenshot?: string;
  /** content hash of the view snapshot this comment was written against */
  snapshot?: string;
  /** when true, comment is resolved */
  resolved?: boolean;
  /** flat replies for now (threaded is a future enhancement) */
  replies?: CommentReply[];
  /** 0-based index of the active iteration version (matches marker on disk). */
  active?: number;
  /**
   * App route (pathname + search + hash) where the comment was created.
   * Used by the list panel to navigate back to the page hosting the anchor.
   */
  route?: string;
};

/**
 * The shape consumed by the overlay UI. Identical to CommentProps plus the
 * `view` slug resolved at parse time by the Vite plugin (or undefined/null
 * when the comment isn't inside a `data-view` ancestor).
 */
export type CommentData = CommentProps & {
  /** slug of the nearest data-view ancestor; null/undefined = page-level */
  view?: string | null;
};

/** @deprecated Kept as an alias for migration; prefer `CommentData`. */
export type RegisteredComment = CommentData;
