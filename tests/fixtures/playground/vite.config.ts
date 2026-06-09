import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// Resolve the design-crit plugin from LOCAL SOURCE, not the published/built
// package, so the e2e suite runs after a bare `pnpm install` with no prior
// `pnpm build`. `design-crit/plugin` -> src/plugin/index.ts re-exports
// `designCrit()` from here.
import { designCrit } from "../../../src/server/plugins/comments.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const resolve = (rel: string) =>
  fileURLToPath(new URL(`../../../${rel}`, import.meta.url));

export default defineConfig({
  // The playground itself is the Vite root; the design-crit plugin scans
  // `<root>/src/**.tsx` (SRC_REL = "src"), where this fixture's App.tsx lives.
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      // The plugin's auto-mounted client imports from the public package
      // entrypoints. Point `design-crit` at local source so no node_modules
      // copy is required, and `design-crit/styles.css` at the REAL compiled
      // Tailwind output so the browser tests exercise the styles users actually
      // ship with — a CSS regression that hides an overlay element fails
      // `toBeVisible()`. `dist/styles.css` is (re)built by
      // tests/e2e/global-setup.ts before the dev server boots.
      "design-crit/styles.css": resolve("dist/styles.css"),
      "design-crit": resolve("src/index.ts"),
    },
  },
  server: {
    fs: {
      // Allow serving source files from the repo root (outside the playground).
      allow: [repoRoot],
    },
  },
  plugins: [designCrit(), react()],
});
