import type { FixStrategy } from "../types.ts";

/** Reserved for a future Cursor SDK backend — not routed by resolveFixStrategy yet. */
export const cursorSdkStrategy: FixStrategy = {
  id: "cursor-sdk",
  run: async () => ({
    ok: false,
    error:
      "Cursor SDK fix strategy is not implemented yet. Use composer-2.5 (CLI) or a Claude model.",
  }),
};
