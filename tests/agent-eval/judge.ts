/**
 * STUB — Tier 3 LLM-as-judge (vision) for real-agent eval quality.
 *
 * Given a scenario's instruction plus the BEFORE and AFTER screenshots of the
 * edited component, ask a vision-capable Claude model whether the edit
 * satisfied the request, returning a 1–5 score + reason. This catches
 * SUBJECTIVE regressions that the objective invariants in `harness.ts` cannot
 * ("make it blue" → is it actually blue?).
 *
 * IMPORTANT: this is a TREND signal, never a hard gate. Log scores over time;
 * do not fail a build on a single low score (model + judge are both noisy).
 *
 * TODO(tier3): before implementing, consult the `claude-api` skill to confirm
 *   the current SDK shape, message/vision content-block format, and the right
 *   model id + pricing. Do NOT hardcode from memory.
 *   - SDK: @anthropic-ai/sdk (separate from the Agent SDK used by runAgent).
 *   - Model: a vision-capable Claude (e.g. "claude-sonnet-4-6" for cost/quality;
 *     confirm via the skill). Read key from ANTHROPIC_API_KEY.
 *   - Force structured output (a tool / JSON schema) so the score parses
 *     deterministically — see the claude-api skill's tool-use section.
 */

export interface JudgeInput {
  /** PNG bytes (or data URL) of the component AFTER the edit. */
  after: Buffer | string;
  /** PNG bytes (or data URL) of the component BEFORE the edit. */
  before: Buffer | string;
  /** The natural-language instruction the agent was given. */
  instruction: string;
}

export interface JudgeVerdict {
  /** Short rationale for the trend log / debugging. */
  reason: string;
  /** 1 (ignored the request) … 5 (fully satisfied it). */
  score: number;
}

/**
 * TODO(tier3): implement with the Anthropic SDK + a structured-output tool.
 * Suggested prompt contract:
 *   "You are grading a UI edit. Given the instruction and the before/after
 *    screenshots, score 1–5 how well the AFTER satisfies the instruction and
 *    explain in one sentence. Penalize collateral changes the instruction did
 *    not ask for."
 */
// biome-ignore lint/suspicious/useAwait: stub — the real Tier 3 impl awaits the Anthropic SDK call
export async function judgeVariant(_input: JudgeInput): Promise<JudgeVerdict> {
  // TODO(tier3): real Anthropic vision call returning a validated {score, reason}.
  throw new Error("judgeVariant: not implemented (Tier 3 stub)");
}
