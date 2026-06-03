/** User-facing version label (1-based), e.g. `v2` for the stored `v === 1`. */
export function formatVersionDisplay(v: number): string {
  return `v${v + 1}`;
}
