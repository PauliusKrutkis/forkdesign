# forkdesign-starter

Self-contained Vite + React app with ForkDesign already wired in. This is the
fastest way to try ForkDesign in a real dev server.

Unlike [`examples/basic-vite`](../basic-vite) (which links the local workspace
build for contributors), this app installs `@pako_krc/forkdesign` from npm, so it runs
anywhere. It is intentionally excluded from the pnpm workspace.

## Scaffold it (no clone)

```sh
npx degit PauliusKrutkis/forkdesign/examples/starter my-forkdesign-app
cd my-forkdesign-app
npm install
npm run dev
```

Open the printed URL, click the ForkDesign pill, then select an element to leave
a comment. The marker is written into `src/app.tsx` — open the file to see the
diff.

## Run from a clone

```sh
npm install
npm run dev
```

## What works here

- **Commenting** — full. Click the pill, select an element, leave a comment; the
  marker is written into `src/app.tsx`. Diff it like any other change.
- **Agent iteration** — configure a local agent (Cursor / Claude, your keys),
  switch to Agent mode, and generate source-backed variants. See the root
  [README](../../README.md#ai-iteration).
