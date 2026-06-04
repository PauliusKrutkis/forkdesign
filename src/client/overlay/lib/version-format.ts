/** User-facing version label (1-based), e.g. `v2` for the stored `v === 1`. */
export function formatVersionDisplay(v: number): string {
  return `v${v + 1}`;
}

/** Label for which iteration a reply or composer message is anchored to. */
export function formatReplyVersionContext(v: number): string {
  return v === 0 ? "Original" : formatVersionDisplay(v);
}
