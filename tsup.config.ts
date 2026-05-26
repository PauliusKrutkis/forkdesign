import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "index": "src/index.ts",
    "plugin/index": "src/plugin/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // Force .mjs/.cjs even though package.json sets "type": "module".
  // The exports map (and external CJS consumers) explicitly resolve to .mjs/.cjs.
  outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
  // peer deps + node builtins stay external in the bundle.
  external: [
    "react",
    "react-dom",
    "react-router-dom",
    "vite",
    "@anthropic-ai/claude-agent-sdk",
    "html-to-image",
    "recast",
    "@babel/parser",
    "@babel/traverse",
    "@babel/types",
  ],
  target: "es2022",
});
