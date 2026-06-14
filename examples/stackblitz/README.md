# forkdesign-stackblitz

Self-contained Vite + React app used for the zero-install
[StackBlitz playground](https://stackblitz.com/github/PauliusKrutkis/forkdesign/tree/main/examples/stackblitz).

Unlike [`examples/basic-vite`](../basic-vite) (which links the local workspace
build), this app installs `forkdesign` from npm, so it runs anywhere — including
in-browser on StackBlitz. It is intentionally excluded from the pnpm workspace.

## What works here

- **Commenting** — full. Click the pill, select an element, leave a comment; the
  marker is written into `src/main.tsx` in the sandbox FS. Open the file to see
  the diff.
- **Agent iteration** — not available in the sandbox (it needs a local agent /
  API keys). Run forkdesign locally for source-backed variants.

## Run locally

```sh
npm install
npm run dev
```
