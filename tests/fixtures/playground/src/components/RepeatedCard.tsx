/**
 * Fixture for the screenshot/switching e2e (PR #30). A SINGLE source element
 * rendered multiple times by `App` (see below), so every instance shares one
 * `data-comment-anchor` once a comment is placed. A comment targets a specific
 * `instance` index (the middle one), which exercises the capture/switch
 * instance logic — "did the RIGHT copy get screenshotted / switched", not just
 * the first match (capture-iteration-screenshot.ts:anchorElement).
 *
 * The `name` prop differs per instance so a captured thumbnail of instance 1 is
 * visually distinguishable from instance 0 — that's how a spec asserts capture
 * accuracy hit the correct copy.
 *
 * The two sentinels are what the scripted agent rewrites to make each variant
 * render distinctly (see src/server/agent/strategies/scripted.ts:visible-edit):
 *   - `data-fd-variant="base"`  → `data-fd-variant="v${n}"`
 *   - text `Design baseline`     → `Design variant ${n}`
 * Keep both on stable single lines so a string/regex swap stays deterministic
 * and the render-signature actually changes between versions.
 *
 * Do NOT commit `@comment` / `data-comment-anchor` markers here — specs write
 * then revert them.
 */
export default function RepeatedCard({ name }: { name: string }) {
  return (
    <article
      className="repeated-card"
      data-fd-variant="base"
      data-testid="repeated-card"
      style={{ border: "1px solid #ccc", borderRadius: 8, padding: 16 }}
    >
      <span data-testid="repeated-card-name">{name}</span>
      <span data-testid="repeated-card-design">Design baseline</span>
    </article>
  );
}
