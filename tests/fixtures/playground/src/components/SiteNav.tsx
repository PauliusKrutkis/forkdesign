/**
 * STUB FIXTURE COMPONENT — multi-component playground (Tier 1 scenarios).
 *
 * Purpose: give the deterministic multi-comment tests a SECOND, distinct
 * component (separate from App.tsx) so we can prove the iteration flow keeps
 * comments on different components isolated — a comment+iteration on <SiteNav>
 * must not disturb markers/snapshots belonging to <Pricing> or <App>.
 *
 * TODO(tier1): flesh this out into a realistic nav with several stable,
 * independently-anchorable elements, each with a `data-testid` on its own line
 * (the e2e picker + the integration `locateTag` helper both need stable lines):
 *   - brand/logo link            data-testid="nav-brand"
 *   - 2–3 nav links              data-testid="nav-link-{features,pricing,docs}"
 *   - a primary CTA button       data-testid="nav-cta"
 * TODO(tier1): keep markup boring/stable — no markers committed here; the tests
 *   write `@comment`/`data-comment-anchor` and revert in afterEach.
 * TODO(cross-file): import a SHARED component (e.g. ../components/Button.tsx)
 *   that <Pricing> also uses, so an agent edit to the shared file exercises the
 *   aux-file / cross-file snapshot path (stubAgent `auxFiles`, and real-agent
 *   eval scenario "edit propagates to shared component").
 * TODO(tier1): mount this in src/App.tsx behind the existing layout WITHOUT
 *   removing the current title/card/cta elements (existing e2e specs target
 *   those testids — do not break them).
 */

export default function SiteNav() {
  // TODO(tier1): replace this placeholder with the nav described above.
  return (
    <nav data-testid="site-nav" aria-label="primary">
      {/* TODO: brand, links, CTA — each on a stable line with a data-testid */}
    </nav>
  );
}
