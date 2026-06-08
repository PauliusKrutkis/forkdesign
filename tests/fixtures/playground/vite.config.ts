import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// Resolve the redline plugin from LOCAL SOURCE, not the published/built package,
// so the e2e suite runs after a bare `pnpm install` with no prior `pnpm build`.
// `redline/plugin` -> src/plugin/index.ts re-exports `redline()` from here.
import { redline } from "../../../src/server/plugins/comments.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const resolve = (rel: string) =>
  fileURLToPath(new URL(`../../../${rel}`, import.meta.url));

export default defineConfig({
  // The playground itself is the Vite root; the redline plugin scans
  // `<root>/src/**.tsx` (SRC_REL = "src"), where this fixture's App.tsx lives.
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      // The plugin's auto-mounted client imports from the public package
      // entrypoints. Point them at local source / a CSS stub so neither a build
      // nor a node_modules copy of `redline` is required.
      "redline/styles.css": resolve(
        "tests/fixtures/playground/redline-styles-stub.css"
      ),
      redline: resolve("src/index.ts"),
    },
  },
  server: {
    fs: {
      // Allow serving source files from the repo root (outside the playground).
      allow: [repoRoot],
    },
  },
  plugins: [redline(), react()],
});
