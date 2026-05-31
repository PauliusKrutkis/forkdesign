// Server-side (Node, vite.config.ts) entry. Vite plugins only.
//
// Kept separate from the client entry so the browser's module graph never
// touches `node:fs`, `recast`, `@babel/*`, etc.

export {
  type CommentsPluginOptions,
  comments,
} from "../server/plugins/comments.ts";
export { sourceLoc } from "../server/plugins/source-loc.ts";
