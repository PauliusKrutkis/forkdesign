/**
 * Fixture component — a third component with REPEATED sibling structure
 * (pricing tiers). The repetition is deliberate: it lets the multi-comment
 * tests anchor several comments on near-identical elements and prove each
 * resolves to the correct distinct source location.
 *
 * The "pro" CTA is the target for the multi-variant batch scenario (count>1),
 * so it is kept on a single stable line.
 */
import Button from "./Button.tsx";

export default function Pricing() {
  return (
    <section aria-label="pricing" data-testid="pricing">
      <article data-testid="tier-free">
        <h3 data-testid="tier-free-title">Free</h3>
        <Button testId="tier-free-cta" variant="secondary">
          Start free
        </Button>
      </article>
      <article data-testid="tier-pro">
        <h3 data-testid="tier-pro-title">Pro</h3>
        <Button testId="tier-pro-cta" variant="primary">
          Go Pro
        </Button>
      </article>
      <article data-testid="tier-team">
        <h3 data-testid="tier-team-title">Team</h3>
        <Button testId="tier-team-cta" variant="secondary">
          Contact sales
        </Button>
      </article>
    </section>
  );
}
