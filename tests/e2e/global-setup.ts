import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Build the REAL shipped stylesheet before the e2e suite runs.
//
// The playground vite.config aliases `forkdesign/styles.css` to the compiled
// Tailwind output (`dist/styles.css`). That file is a build artifact, so we
// regenerate it here — via the exact same `build:css` pipeline that ships to
// npm (tailwind + unwrap-css-layers) — so the browser tests exercise the
// styles users actually get, not an empty stub. This is what lets the
// `toBeVisible()` assertions catch a CSS regression that hides an element.
//
// globalSetup runs before Playwright starts the `webServer`, so the aliased
// file is guaranteed to exist by the time Vite resolves the import.
export default function globalSetup(): void {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  // eslint-disable-next-line no-console
  console.log("[e2e] building dist/styles.css (real shipped CSS)…");
  execFileSync("pnpm", ["run", "build:css"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (!existsSync(fileURLToPath(new URL("../../dist/styles.css", import.meta.url)))) {
    throw new Error(
      "[e2e] build:css did not produce dist/styles.css — the playground alias would fail to resolve."
    );
  }
}
