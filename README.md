# redline

**Why not Onlook / v0 / Builder Visual Copilot?** Those tools keep design history in their platform — redline stores feedback as `{/* @comment … */}` markers inline in your real `.tsx` source and saves per-comment iteration snapshots on disk next to your repo, so design history lives in git with your code, not in a SaaS.

Dev-only overlay for **Vite + React design playgrounds** — click a component, leave a note, optionally let Claude apply the fix. Not a general visual editor.

> **0.x scope:** React 19 + Vite 8 + React Router 7 peer deps. Tailwind required in the host app. API may change between minors until 1.0.

## Install

```sh
pnpm add -D redline
# or: npm install --save-dev redline
```

From GitHub (before npm publish):

```sh
pnpm add -D github:PauliusKrutkis/redline
```

**Peer dependencies:** `react`, `react-dom`, `react-router-dom`, `vite`.

**AI iteration** uses the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). Credentials come from your environment (`ANTHROPIC_API_KEY`, Claude Code login, etc.) — redline ships no telemetry and no credential handling.

## Quick start

```ts
// vite.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { comments, sourceLoc } from "redline/plugin";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [
    sourceLoc({ projectRoot }),
    react(),
    comments(),
  ],
});
```

```tsx
// App.tsx
import { CommentOverlay } from "redline";
import "redline/styles.css";

export function App() {
  return (
    <>
      <YourPlayground />
      {import.meta.env.DEV && <CommentOverlay />}
    </>
  );
}
```

Your app needs **Tailwind CSS** enabled. Overlay components use utility classes with CSS-variable fallbacks (`bg-[var(--co-surface)]`, etc.). Import `redline/styles.css` for defaults; override `--co-*` variables to retheme.

**Important:** Tailwind must scan redline's component files or those utilities won't be emitted. Spread the package content globs into your config:

```js
// tailwind.config.js
import { tailwindContent } from "redline/tailwind.content";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", ...tailwindContent],
  // ...
};
```

Optional author override for new comments:

```html
<script>window.__COMMENT_AUTHOR__ = "you@example.com";</script>
```

## How it works

1. **`sourceLoc`** — dev-only Vite plugin stamps host JSX elements with `data-source-loc="src/…/File.tsx:line:col"`.
2. **`comments`** — dev-only Vite middleware reads/writes `{/* @comment id="…" anchor="…" text="…" … */}` markers in `.tsx` files under `src/`.
3. **`CommentOverlay`** — React UI: dots on anchored elements, composer, version switcher, optional AI iterate.

On create, redline saves a screenshot to `public/designs/iterations/<comment-id>/v0.png`. Each AI iteration writes `designs/iterations/<comment-id>/v{N}.{tsx,png}` on disk. Symlink `public/designs` → `designs` if you want snapshots served as static assets.

Comment markers in source look like:

```tsx
<button data-comment-anchor="550e8400-e29b-41d4-a716-446655440000">
  Save
</button>
{/* @comment id="550e8400-e29b-41d4-a716-446655440000" anchor="550e8400-e29b-41d4-a716-446655440000" text="Too heavy" author="you@example.com" date="2026-05-26T12:00:00.000Z" */}
```

## Plugin options

```ts
comments({
  // Skip comment read/write under these project-relative prefixes:
  excludeSrcPrefixes: ["src/dev/", "src/components/comments/"],
});

sourceLoc({
  projectRoot,
  excludeSrcPrefixes: ["src/components/comments/"],
});
```

## Comment overlay options

```tsx
import { CommentOverlay } from "redline";
import { useNavigate } from "react-router-dom";

const navigate = useNavigate();

<CommentOverlay
  navigate={navigate}
  fileToRoute={(file, { view }) => {
    // Optional: map source files to routes for legacy comments without `route`
    if (file === "src/pages/Home.tsx") return "/";
    return null;
  }}
/>
```

New comments store the current URL on the `@comment` marker (`route="/path?query#hash"`). The comment list uses that to **Go to page** for off-page rows. **Minimal** mode (Settings → Interface) hides floating buttons; use `C` comment, `L` list, `,` settings, `Esc` close.

## Multi-frame prototypes

Wrap distinct views in `<section data-view="empty">…</section>`. Single-view pages need no wrapper.

## Theming

Override CSS variables after importing `redline/styles.css`. See [`src/styles.css`](./src/styles.css) for the full `--co-*` set. The overlay adds `.comment-overlay--dark` when the user picks dark mode in settings.

## Public API

| Export | Description |
|--------|-------------|
| `CommentOverlay` | Root React component (mount once, gate on `import.meta.env.DEV`) |
| `comments()` | Vite plugin — `/api/comments`, `/api/iterations` |
| `sourceLoc()` | Vite plugin — `data-source-loc` transform |
| `redline/styles.css` | Default theme tokens |
| `redline/tailwind.content` | Tailwind `content` globs — required for overlay utilities |

Types: `CommentData`, `RegisteredComment`, `OverlaySettings`, etc. from the main entry.

## Linked local development

When a host app depends on a sibling checkout (`"redline": "link:../redline"`), use this loop:

**One-time host setup** (e.g. `seo-analysis`):

```json
// package.json
"redline": "link:../redline"
```

```ts
// vite.config.ts — load redline source + watch the linked folder for HMR
resolve: { conditions: ["source", "module", "browser", "development|production"] },
optimizeDeps: { exclude: ["redline"] },
server: { watch: { ignored: ["!../redline/**"] } },
```

```js
// tailwind.config.js — emit overlay utility classes
import { tailwindContent } from "redline/tailwind.content";
content: ["./src/**/*.{js,ts,jsx,tsx}", ...tailwindContent],
```

```tsx
// main.tsx
import "redline/styles.css";
```

Then `pnpm install` in the host and start its dev server (`pnpm dev`).

**Day-to-day:** edit files under `redline/src/`. With the config above, React/CSS changes hot-reload in the host. **Restart the host dev server** after changes to redline's Vite plugins (`src/plugin.ts`, `src/source-loc-plugin.ts`) or after editing `package.json` exports — those load at startup.

You do **not** need `pnpm build` in redline for UI work; the host reads `redline/src` directly via the `source` export condition.

## Local development (this repo)

```sh
pnpm install
pnpm test
pnpm build
```

## License

MIT
