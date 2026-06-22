/**
 * SCAFFOLDING — test-only HTTP control plane for the scripted agent.
 *
 * Mounted by the iterations middleware ONLY when the scripted agent is enabled
 * (`FORKDESIGN_E2E_SCRIPTED=1`), so it never exists in a real dev server. It
 * lets a Playwright spec drive the gated agent deterministically:
 *
 *   POST /api/iterations/__e2e__/advance  { id }
 *     → release the next gated variant for comment `id` (see
 *       strategies/scripted.ts:advanceScriptedAgentVariant).
 *
 * Planned additions:
 *   POST /api/iterations/__e2e__/await-arrival { id, variantIndex }
 *     → resolve once the agent has REACHED that variant's gate, so the spec
 *       gets a clean "variant N is now in progress" signal with no polling.
 *   POST /api/iterations/__e2e__/reset
 *     → clear all gates between specs.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * TODO(dispatch): route the `__e2e__/*` subpath to the handlers below.
 * Wire from handleIterationsMiddleware behind `isScriptedAgentEnabled()`:
 *
 *   if (isScriptedAgentEnabled() && sub.startsWith("/__e2e__/")) {
 *     wrapApiHandler((r, s) => handleE2eControl(r, s, sub))(req, res);
 *     return;
 *   }
 *
 * Returns true when it handled the request so the caller can `return`.
 */
export function handleE2eControl(
  _req: IncomingMessage,
  _res: ServerResponse,
  _sub: string
): Promise<void> {
  // TODO(advance): parse { id } from the JSON body (readJsonBody), call
  // advanceScriptedAgentVariant(id), and sendJson({ ok, released }) — or
  // sendError(409) when there was nothing to advance.
  //
  // TODO(await-arrival): parse { id, variantIndex }, await the gate's
  // arrivedPromise, then sendJson({ ok: true }). Add a timeout so a wrong id
  // fails fast instead of hanging the spec.
  //
  // TODO(reset): call resetScriptedAgentGates(), sendJson({ ok: true }).
  throw new Error("handleE2eControl: not implemented (scaffolding)");
}
