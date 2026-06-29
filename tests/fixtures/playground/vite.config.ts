import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// Resolve the forkdesign plugin from LOCAL SOURCE, not the published/built
// package, so the e2e suite runs after a bare `pnpm install` with no prior
// `pnpm build`. `@pako_krc/forkdesign/plugin` -> src/plugin/index.ts re-exports
// `forkDesign()` from here.
import { forkDesign } from "../../../src/server/plugins/comments.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const resolve = (rel: string) =>
  fileURLToPath(new URL(`../../../${rel}`, import.meta.url));

export default defineConfig({
  // The playground itself is the Vite root; the forkdesign plugin scans
  // `<root>/src/**.tsx` (SRC_REL = "src"), where this fixture's App.tsx lives.
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      // The plugin's auto-mounted client imports from the public package
      // entrypoints. Point `@pako_krc/forkdesign` at local source so no node_modules
      // copy is required, and `@pako_krc/forkdesign/styles.css` at the REAL compiled
      // Tailwind output so the browser tests exercise the styles users actually
      // ship with — a CSS regression that hides an overlay element fails
      // `toBeVisible()`. The built `dist/` (styles.css + index.mjs) is produced
      // by the playwright `webServer` command before the dev server boots.
      "@pako_krc/forkdesign/styles.css": resolve("dist/styles.css"),
      "@pako_krc/forkdesign": resolve("src/index.ts"),
    },
  },
  server: {
    fs: {
      // Allow serving source files from the repo root (outside the playground).
      allow: [repoRoot],
    },
  },
  plugins: [forkDesign(), react()],
});
