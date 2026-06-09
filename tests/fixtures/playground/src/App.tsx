/**
 * E2E playground app rendered by the Vite dev server for the Playwright suite.
 *
 * This is intentionally separate from the integration fixture
 * `tests/fixtures/playground/App.tsx` (which is copied into a temp project by
 * `tests/helpers/temp-project.ts`). This file lives under `src/` so the design-crit
 * plugin (which scans `<viteRoot>/src/**.tsx`) can stamp source locations and
 * write `@comment` markers into it when an e2e test submits a comment.
 *
 * Keep elements on stable lines with `data-testid`s so the browser tests can
 * target them deterministically. Do NOT commit `@comment`/`data-comment-anchor`
 * markers here — the e2e tests write and then revert them.
 */

export default function App() {
  return (
    <main
      data-view="playground"
      style={{ padding: 48, fontFamily: "sans-serif" }}
    >
      <h1 data-testid="title">Design Crit E2E Playground</h1>
      <div className="card" data-testid="card" style={{ marginTop: 24 }}>
        <p data-testid="card-body">
          A minimal surface for anchoring comments in browser tests.
        </p>
        <button data-testid="cta" type="button">
          Click me
        </button>
      </div>
    </main>
  );
}
