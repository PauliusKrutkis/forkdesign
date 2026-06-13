import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
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
  // Peer/runtime deps stay external; UI stack is bundled so hosts never
  // resolve lucide/Radix from forkdesign/node_modules (duplicate React in Vite dev).
  noExternal: [
    "lucide-react",
    /^@radix-ui\//,
    "class-variance-authority",
    "clsx",
    "tailwind-merge",
  ],
  external: [
    "react",
    "react-dom",
    "vite",
    "@anthropic-ai/claude-agent-sdk",
    "recast",
    "@babel/parser",
    "@babel/traverse",
    "@babel/types",
  ],
  target: "es2022",
});
