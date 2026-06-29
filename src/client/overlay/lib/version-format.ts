export function formatVersionDisplay(v: number): string {
  return `v${v + 1}`;
}

export function formatReplyVersionContext(v: number): string {
  return v === 0 ? "Original" : formatVersionDisplay(v);
}
