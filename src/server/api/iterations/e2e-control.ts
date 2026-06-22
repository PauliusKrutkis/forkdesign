/**
 * Test-only HTTP control plane for the scripted agent (PR #30).
 *
 * Mounted by the iterations middleware ONLY when `FORKDESIGN_E2E_SCRIPTED=1`, so
 * it never exists in a real dev server. Lets a Playwright spec drive the gated
 * agent deterministically:
 *
 *   POST /api/iterations/__e2e__/advance        { id }
 *     → release the variant currently waiting at its gate.
 *   POST /api/iterations/__e2e__/await-arrival   { id, variantIndex }
 *     → resolve once the agent has REACHED that variant's gate (clean
 *       "variant N is now in progress" signal, no polling).
 *   POST /api/iterations/__e2e__/reset
 *     → clear all gates between specs.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  advanceScriptedAgentVariant,
  awaitScriptedAgentArrival,
  resetScriptedAgentGates,
} from "../../agent/strategies/scripted.ts";
import { readJsonBody, sendError, sendJson } from "../../platform/http.ts";

export async function handleE2eControl(
  req: IncomingMessage,
  res: ServerResponse,
  sub: string
): Promise<void> {
  if (sub === "/__e2e__/reset") {
    resetScriptedAgentGates();
    sendJson(res, { ok: true });
    return;
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    sendError(res, 400, body.reason);
    return;
  }
  const payload = body.value as { id?: unknown; variantIndex?: unknown };
  const id = payload.id;
  if (typeof id !== "string" || !id.trim()) {
    sendError(res, 400, "missing field: id");
    return;
  }

  if (sub === "/__e2e__/advance") {
    const released = advanceScriptedAgentVariant(id);
    sendJson(res, { ok: released, released });
    return;
  }

  if (sub === "/__e2e__/await-arrival") {
    const variantIndex = payload.variantIndex;
    if (typeof variantIndex !== "number") {
      sendError(res, 400, "missing field: variantIndex");
      return;
    }
    await awaitScriptedAgentArrival(id, variantIndex);
    sendJson(res, { ok: true });
    return;
  }

  sendError(res, 404, `unknown e2e control route: ${sub}`);
}
