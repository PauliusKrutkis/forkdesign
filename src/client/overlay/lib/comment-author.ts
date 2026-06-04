export function getCommentAuthor(): string {
  const override =
    typeof window === "undefined"
      ? undefined
      : (window as unknown as { __COMMENT_AUTHOR__?: unknown })
          .__COMMENT_AUTHOR__;
  return override ? String(override) : "dev@local";
}

export function currentAppRoute(): string | undefined {
  if (typeof window === "undefined") {
    return;
  }
  return (
    window.location.pathname + window.location.search + window.location.hash
  );
}
