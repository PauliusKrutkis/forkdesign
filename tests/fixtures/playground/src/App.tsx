/**
 * E2E playground app rendered by the Vite dev server for the Playwright suite.
 *
 * This is intentionally separate from the integration fixture
 * `tests/fixtures/playground/App.tsx` (which is copied into a temp project by
 * `tests/helpers/temp-project.ts`). This file lives under `src/` so the forkdesign
 * plugin (which scans `<viteRoot>/src/**.tsx`) can stamp source locations and
 * write `@comment` markers into it when an e2e test submits a comment.
 *
 * Keep elements on stable lines with `data-testid`s so the browser tests can
 * target them deterministically. Do NOT commit `@comment`/`data-comment-anchor`
 * markers here — the e2e tests write and then revert them.
 */

import Pricing from "./components/Pricing.tsx";
import RepeatedCard from "./components/RepeatedCard.tsx";
import SiteNav from "./components/SiteNav.tsx";

export default function App() {
  return (
    <main
      data-view="playground"
      style={{ padding: 48, fontFamily: "sans-serif" }}
    >
      <SiteNav />
      <h1 data-testid="title">ForkDesign E2E Playground</h1>
      <div className="card" data-testid="card" style={{ marginTop: 24 }}>
        <p data-testid="card-body">
          A minimal surface for anchoring comments in browser tests.
        </p>
        <button data-testid="cta" type="button">
          Click me
        </button>
      </div>
      <Pricing />
      {/*
        Repeated single-source component for the screenshot/switching e2e.
        All three share one data-comment-anchor once a comment is placed; specs
        comment on the middle instance (index 1) to test instance-accurate
        capture + switching. See components/RepeatedCard.tsx.
      */}
      <section aria-label="repeated cards" data-testid="repeated-cards">
        {["Alpha", "Beta", "Gamma"].map((name) => (
          <RepeatedCard key={name} name={name} />
        ))}
      </section>
    </main>
  );
}
