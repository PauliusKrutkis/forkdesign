// biome-ignore-all lint/performance/noBarrelFile: public package entrypoint

export {
  CommentOverlay,
  type CommentOverlayProps,
} from "./client/overlay/comment-overlay.tsx";
export type { OverlaySettings } from "./client/settings.ts";
export type {
  CommentData,
  CommentProps,
  CommentReply,
  RegisteredComment,
} from "./client/types.ts";
