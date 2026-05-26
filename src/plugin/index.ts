// Server-side (Node, vite.config.ts) entry. Vite plugins only.
//
// Kept separate from the client entry so the browser's module graph never
// touches `node:fs`, `recast`, `@babel/*`, etc.

export { comments, type CommentsPluginOptions } from "../plugin.ts";
export { sourceLoc } from "../source-loc-plugin.ts";
