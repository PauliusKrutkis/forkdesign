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

**AI iteration (Fix)** uses a **preferred model + automatic fallback chain**:

- **Preferred model** — set in overlay Settings → Preferred model (default: `composer-2.5-fast`).
- **Fallback order** — `composer-2.5-fast` → `composer-2.5` → `claude-sonnet-4-6` → `default`, skipping models unavailable in your environment (Composer ids are probed via `agent models`).
- **Claude** — [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk); `ANTHROPIC_API_KEY` or Claude Code login.
- **Composer** — [Cursor CLI](https://cursor.com/docs/cli) (`agent`); `agent login` or `CURSOR_API_KEY`.

Override the chain with `comments({ fixModelPriority: [...] })`. The `done` event includes `modelUsed` and `durationMs`.

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

Import `redline/styles.css` for overlay theme tokens (`--background`, `--primary`, …). Scan redline so utility classes (`bg-background`, `text-primary`, …) are emitted.

**Tailwind v4** — add `@source` for redline dist (or linked `src`):

```css
@import "tailwindcss";
@import "redline/styles.css";
@source "../node_modules/redline/dist/**/*.{js,mjs}";
```

**Tailwind v3** — import the preset and content paths:

```js
import { tailwindContent } from "redline/tailwind.content";
import redlinePreset from "redline/tailwind.preset";

export default {
  presets: [redlinePreset],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", ...tailwindContent],
};
```

```css
@import "redline/styles.css";
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Linked local dev (`pnpm link:../redline`)** — resolve the built package (default), not raw `source` exports. The published `dist` bundles Radix/lucide so Vite does not pull a second copy of React from `redline/node_modules` (that mismatch blanks the page in Firefox/Zen). Run `pnpm dev` in the redline checkout for overlay HMR, then refresh the host app. If you still see “Invalid hook call”, add `resolve.dedupe: ["react", "react-dom"]` in the host `vite.config.ts` and use `http://127.0.0.1:5173` instead of `localhost` in Zen.

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

### Dev API (`comments()` middleware)

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| `GET` | `/api/comments` | — | List all comment markers |
| `GET` | `/api/comments?file=src/…/Page.tsx` | — | Comments in one file |
| `POST` | `/api/comments` | `{ file, line, column, text, author, … }` | Create marker |
| `PATCH` | `/api/comments/:id` | `{ text }` or `{ reply: { text, author } }` | Edit body or append reply |
| `DELETE` | `/api/comments/:id` | — | Remove marker |

## Plugin options

```ts
comments({
  // Skip comment read/write under these project-relative prefixes:
  excludeSrcPrefixes: ["src/dev/", "src/components/comments/"],
  // Optional: path to Cursor CLI when `agent` is not on PATH
  cursorAgentPath: "/usr/local/bin/agent",
  // Optional: override Fix fallback order (preferred model still goes first)
  fixModelPriority: ["composer-2.5-fast", "composer-2.5", "claude-sonnet-4-6", "default"],
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

The overlay uses shadcn semantic tokens (`--background`, `--primary`, `--muted`, etc.) defined in [`src/styles.css`](./src/styles.css). Override `:root` variables in your app after importing `redline/styles.css` to retheme the overlay chrome.

## Public API

| Export | Description |
|--------|-------------|
| `CommentOverlay` | Root React component (mount once, gate on `import.meta.env.DEV`) |
| `comments()` | Vite plugin — `/api/comments`, `/api/iterations` |
| `sourceLoc()` | Vite plugin — `data-source-loc` transform |
| `redline/styles.css` | Shadcn zinc theme + pin animations |
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
