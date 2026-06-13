/**
 * Fixture component — a second, distinct component (separate from App.tsx) so
 * the multi-comment tests can prove iteration keeps comments on different
 * components isolated: a comment/iteration on <SiteNav> must not disturb
 * markers or snapshots belonging to <Pricing> or <App>.
 *
 * Markup is intentionally boring and stable — each anchorable element sits on
 * its own line with a `data-testid`. Tests write `@comment`/`data-comment-anchor`
 * markers here and revert them in afterEach.
 */
import Button from "./Button.tsx";

export default function SiteNav() {
  return (
    <nav aria-label="primary" data-testid="site-nav">
      <a data-testid="nav-brand" href="#home">
        ForkDesign
      </a>
      <a data-testid="nav-link-features" href="#features">
        Features
      </a>
      <a data-testid="nav-link-pricing" href="#pricing">
        Pricing
      </a>
      <a data-testid="nav-link-docs" href="#docs">
        Docs
      </a>
      <Button testId="nav-cta" variant="primary">
        Get started
      </Button>
    </nav>
  );
}
