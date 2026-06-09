/**
 * Canonical fixture component for round-trip integration tests.
 *
 * This is the source `design-crit`'s server flows mutate in tests: comment markers
 * are written into it (src/server/comments/writer.ts), read back out
 * (src/server/comments/reader.ts, src/server/comments/find-comment.ts), and the
 * agent (stubbed in tests — see tests/helpers/stub-agent.ts) edits it to
 * produce iteration snapshots under `designs/iterations/<id>/`.
 *
 * Kept deliberately small and realistic (React 19, function component, a few
 * anchorable elements: a heading, a div, a button). Each top-level element is a
 * valid JSXElement so `findJsxElementAt(line, column)` in the writer can target
 * it. The `data-view` attribute exercises view resolution in the reader.
 *
 * TODO (fixture maintenance): if you add more anchor targets, keep them on
 * their own lines with stable indentation so line/column-based tests stay
 * deterministic. Do NOT add `data-comment-anchor`/`@comment` markers here — let
 * the writer create them so the round-trip starts from a clean baseline.
 *
 * Consumers: `createTempProject` copies the playground tree into a temp dir;
 * this file is expected to live under `src/` there so `find-comment.ts` (which
 * walks `SRC_REL = "src"`) can discover any markers written into it.
 */

export default function App() {
  return (
    <main data-view="playground">
      <h1>Design Crit Playground</h1>
      <div className="card">
        <p>A minimal surface for anchoring comments in tests.</p>
        <button type="button">Click me</button>
      </div>
    </main>
  );
}
