# forkdesign

Dev-only comments for **Vite + React design playgrounds**. Click an element,
leave feedback, and optionally let an agent generate source-backed iterations.

ForkDesign stores feedback in your repo: comment markers live in `.tsx` files and
iteration snapshots live under `designs/`.

> 0.x scope: React 19 and Vite 8. APIs may change before 1.0.

## Screenshots

![ForkDesign comment composer over a Vite React design playground](./docs/assets/forkdesign-commenting.png)

![ForkDesign agent iteration thread with version previews](./docs/assets/forkdesign-agent-iterations.png)

## Is this for you?

**Yes, if:**

- You build UIs with **React + Vite** and want to iterate on design in the
  running app, against real components.
- You want feedback and variants to live **in your repo** — JSX markers and
  on-disk snapshots you commit, `git diff`, and `git checkout` — not in a vendor
  database.
- You're fine with a dev-only tool that edits your source, *because* every edit
  is a reviewable, revertable diff.
- You want one focused workflow, not a platform.

**No, if:**

- You need a hosted space for **non-technical stakeholders** to leave feedback.
  ForkDesign runs on a developer's dev server; it is not a SaaS and there is no
  hosted mode.
- You're **not on React + Vite**. There is no other framework support (0.x
  targets React 19 and Vite 8).
- You want an **app generator** that builds whole pages or products from a
  prompt. ForkDesign iterates on components you already have — it is not v0 or
  Lovable.

## How it compares

ForkDesign is deliberately narrow. It is not a generator and not a design
platform — it is local-first design iteration that keeps its history in your
git.

| | **ForkDesign** | v0 / Lovable | Onlook |
| --- | --- | --- | --- |
| Where it runs | Your local Vite dev server | Hosted SaaS | Local app on your project |
| Where state lives | **Your git repo** (JSX markers + on-disk snapshots) | Vendor cloud | Your source files |
| Primary job | Iterate on existing components | Generate apps/pages from a prompt | Visual editing |
| AI | Your local agent (Cursor / Claude), your keys | Provider-hosted | Provider-hosted |
| Frameworks | React + Vite only | Flexible / Next.js-first | React |
| Each change is | A git diff you review and revert | Cloud state you export | Edits to source |

**Where ForkDesign wins:** local-first (no vendor database, no account), every
change is a reviewable diff in your repo, and it does one workflow well.

**Where it doesn't:** it won't generate an app from scratch, it's React + Vite
only, and it's built for a single developer's local loop — there's no built-in
team/collaboration layer.

## Install

```sh
pnpm add -D forkdesign
# or: npm install --save-dev forkdesign
```

Peer dependencies: `react`, `react-dom`, `vite`.

Requirements: Node 20 or newer. The development commands in this repository use
pnpm.

## Quick Start

Add the Vite plugin:

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { forkDesign } from "forkdesign/plugin";

export default defineConfig({
  plugins: [forkDesign(), react()],
});
```

That is the only setup for the default path. `forkDesign()` runs in dev only,
stamps JSX source locations, installs the comment/iteration API, imports the
compiled overlay CSS, and mounts the overlay. Your app does not need to scan
forkdesign with Tailwind.

## Using ForkDesign

Open your app in dev, click the forkdesign button, then click an element to leave a
comment. New comments are written as JSX markers:

```tsx
<button data-comment-anchor="550e8400-e29b-41d4-a716-446655440000">
  Save
</button>
{/* @comment id="550e8400-e29b-41d4-a716-446655440000" anchor="550e8400-e29b-41d4-a716-446655440000" text="Too heavy" author="you@example.com" date="2026-05-26T12:00:00.000Z" */}
```

Screenshots and agent iterations are written under `designs/`. Add `designs/`
and `public/designs/` to the host app's `.gitignore` if those artifacts should
stay local.

## Example

Try the minimal Vite app in [`examples/basic-vite`](./examples/basic-vite):

```sh
pnpm install
pnpm build
pnpm example
```

That app is only the default `forkDesign()` plugin plus a small React surface. It
does not manually import the overlay or use Tailwind. Comment markers are
written into `examples/basic-vite/src/`; local iteration artifacts land under
`examples/basic-vite/designs/`.

## AI Iteration

Agent mode uses your configured local tools:

- Cursor CLI (`agent`): run `agent login` or set `CURSOR_API_KEY`.
- Claude: set `ANTHROPIC_API_KEY` or use Claude Code login.
- Optional: set `CURSOR_AGENT_PATH` when the Cursor CLI binary is not named
  `agent`.

Copy `.env.example` if you want to document local agent credentials for a host
app. ForkDesign does not send keys to the browser; local agent tools read their own
credentials.

Default model order:

```txt
composer-2.5-fast -> composer-2.5 -> claude-sonnet-4-6 -> default
```

Override it in `vite.config.ts`:

```ts
forkDesign({
  agentModelPriority: ["composer-2.5-fast", "claude-sonnet-4-6", "default"],
  agentSkills: ["frontend-design"], // pass [] to disable skill guidance
});
```

## Options

```ts
forkDesign({
  allowRemoteAccess: false,
  excludeSrcPrefixes: ["src/dev/"],
  cursorAgentPath: "/usr/local/bin/agent",
  agentModelPriority: ["composer-2.5-fast", "composer-2.5", "default"],
  agentSkills: ["frontend-design"],
});
```

If you want to mount the overlay yourself, use the lower-level plugins:

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { comments, sourceLoc } from "forkdesign/plugin";

export default defineConfig({
  plugins: [sourceLoc(), react(), comments()],
});
```

```tsx
import { CommentOverlay } from "forkdesign";
import "forkdesign/styles.css";

export function App() {
  return (
    <>
      <YourPlayground />
      {import.meta.env.DEV && <CommentOverlay />}
    </>
  );
}
```

## Safety

ForkDesign is a local development tool. Its Vite middleware can read and write app
source files, write screenshots and iteration artifacts, and run configured AI
agents. Do not expose a Vite dev server running forkdesign to an untrusted network
or run it with `vite --host` unless the network is trusted.

The API rejects non-loopback clients by default. Pass `allowRemoteAccess: true`
only when the dev server is intentionally reachable from a trusted network.

When AI iteration is enabled, selected source context, comments, screenshots,
and feedback may be sent to your configured provider. See [`SECURITY.md`](./SECURITY.md).

## Public API

| Import | Exports |
| --- | --- |
| `forkdesign` | `CommentOverlay` and public types |
| `forkdesign/plugin` | `forkDesign()`, `comments()`, `sourceLoc()` |
| `forkdesign/styles.css` | Compiled overlay CSS |

## Development

Architecture notes live in [`docs/architecture.md`](./docs/architecture.md).
`AGENTS.md` is guidance for AI coding assistants; human contributors should
start with [`CONTRIBUTING.md`](./CONTRIBUTING.md).
For a manual smoke check in a real Vite dev server, use `pnpm example`.

```sh
pnpm install
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
