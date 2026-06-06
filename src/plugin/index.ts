// biome-ignore-all lint/performance/noBarrelFile: public package entrypoint

export type {
  CommentsPluginOptions,
  RedlinePluginOptions,
} from "../server/plugins/comments.ts";
export {
  comments,
  redline,
  sourceLoc,
} from "../server/plugins/comments.ts";
