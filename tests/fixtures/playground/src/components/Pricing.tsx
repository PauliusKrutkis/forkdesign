/**
 * STUB FIXTURE COMPONENT — multi-component playground (Tier 1 scenarios).
 *
 * Purpose: a THIRD distinct component with REPEATED sibling structure (pricing
 * tiers). The repetition is deliberate — it lets the multi-variant + multi-
 * comment tests anchor several comments on near-identical elements and prove
 * each comment resolves to the correct distinct anchor/source location.
 *
 * TODO(tier1): render 3 pricing cards as siblings, each independently
 *   anchorable, each on its own stable line:
 *     - card root            data-testid="tier-{free,pro,team}"
 *     - card title           data-testid="tier-{...}-title"
 *     - card CTA button      data-testid="tier-{...}-cta"
 * TODO(multi-variant): the "pro" CTA is the target for the N-variant batch
 *   scenario (count>1) — keep it on a single stable line.
 * TODO(cross-file): render the SHARED Button component here too (see SiteNav
 *   TODO) so a cross-file agent edit shows up as an aux-file snapshot.
 * TODO(tier1): mount in src/App.tsx alongside (not replacing) existing elements.
 */

export default function Pricing() {
  // TODO(tier1): replace with the 3-tier layout described above.
  return (
    <section data-testid="pricing" aria-label="pricing">
      {/* TODO: free / pro / team cards, each with stable testids per element */}
    </section>
  );
}
