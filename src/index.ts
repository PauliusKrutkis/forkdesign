// Client-side (browser) entry. Re-exports the React surface only.
//
// The Vite plugins (which use Node builtins like `node:fs`, `node:path`,
// `node:crypto`, and depend on `recast` + `@babel/*`) live in the
// `./plugin` sub-path entry. Keeping them apart is critical: when the
// browser fetches this barrel, it should never pull server-only modules
// into the module graph (Vite externalises node builtins, but the import
// chain still goes through `recast` etc. which makes the whole tree fail).

export {
  CommentOverlay,
  type CommentOverlayProps,
} from "./client/overlay/CommentOverlay.tsx";
export type { OverlaySettings } from "./client/settings.ts";
// Types exported for consumers that want to type their own UI on top.
export type {
  CommentData,
  CommentProps,
  CommentReply,
  RegisteredComment,
} from "./client/types.ts";
