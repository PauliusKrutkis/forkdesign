/**
 * STUB — Tier 2 real-agent eval scenario catalog.
 *
 * A scenario is a self-contained description of ONE real-agent run to grade:
 * which fixture component to comment, where to anchor, what instruction to give,
 * how many variants, and what invariants/quality bar to expect. The harness
 * (`harness.ts`) materializes each into a temp project, runs the REAL agent, and
 * grades the output via invariants + the LLM judge.
 *
 * These intentionally reuse the multi-component playground fixture so the same
 * surface backs both the deterministic Tier 1 tests and the real-agent evals.
 */

// TODO(tier2): import the real types once the harness is implemented:
//   import type { AgentModel } from "../../src/server/agent/models.ts";
//   import type { AgentSkill } from "../../src/server/agent/types.ts";

export interface EvalScenario {
  /** One-line human description. */
  description: string;
  /** Stable id for filtering (`--scenario`) and trend tracking. */
  id: string;
  /** The natural-language instruction handed to the agent. */
  instruction: string;
  /**
   * Objective expectations the harness checks regardless of subjective quality.
   * TODO(tier2): tighten these into a typed predicate set in harness.ts.
   */
  invariants: {
    /** Files (fixture-relative) the agent is ALLOWED to touch. */
    mayEdit: string[];
    /** Markers/ids that MUST remain byte-identical after the run. */
    mustNotDisturb?: string[];
    /** Require the post-edit screenshot to differ from baseline. */
    expectVisualChange: boolean;
  };
  /** Minimum acceptable LLM-judge score (1–5) for the trend dashboard. */
  minJudgeScore?: number;
  /** Fixture-relative component file to comment, e.g. "components/Pricing.tsx". */
  targetFile: string;
  /** JSX tag (or testid) to anchor the comment on. */
  targetTag: string;
  /** How many variants to request (exercises count>1 batches). */
  variantCount: number;
  // TODO(tier2): model?: AgentModel; skills?: AgentSkill[]; per-scenario.
}

// TODO(tier2): fill in real scenarios. Sketch of the catalog we want:
export const SCENARIOS: EvalScenario[] = [
  // {
  //   id: "precise-color-change",
  //   description: "Precise instruction on a single component, 1 variant",
  //   targetFile: "components/Pricing.tsx",
  //   targetTag: "button", // the pro-tier CTA
  //   instruction: "Make this button's background solid blue (#2563eb).",
  //   variantCount: 1,
  //   invariants: { mayEdit: ["components/Pricing.tsx"], expectVisualChange: true },
  //   minJudgeScore: 4,
  // },
  // TODO: "vague-instruction" — e.g. "make it pop" → expectVisualChange, lower bar.
  // TODO: "multi-variant-divergence" — count: 3, assert 3 visually-distinct results.
  // TODO: "cross-file-shared-component" — edit must propagate to shared Button.tsx
  //        (mayEdit includes the shared file; invariant: aux snapshot present).
  // TODO: "isolation" — comment on SiteNav, assert Pricing/App markers untouched
  //        (mustNotDisturb lists the other component ids).
  // TODO: "no-op-guard" — instruction the agent should reasonably refuse to
  //        change; assert changed:false is surfaced, not a hallucinated edit.
];

// TODO(tier2): export a `selectScenarios(filter?: string)` helper for --scenario.
