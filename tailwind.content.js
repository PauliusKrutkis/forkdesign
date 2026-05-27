import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const packageRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Tailwind `content` globs for redline overlay components.
 *
 * Host apps must include these paths so utilities like
 * `bg-[var(--co-surface)]` are generated for linked/npm installs.
 */
export const tailwindContent = [
  join(packageRoot, "src/**/*.{js,ts,jsx,tsx}"),
  join(packageRoot, "dist/**/*.{js,mjs,cjs}"),
];

export default tailwindContent;
