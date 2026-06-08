# basic-vite

Minimal Vite + React host app for trying Redline locally.

## Run from the repo root

```sh
pnpm install
pnpm build
pnpm example
```

Open the printed localhost URL, click the Redline button, then select an element
on the page to leave a comment.

Comment markers are written into `src/*.tsx`; iteration artifacts go under
`designs/`, which is gitignored here.

## Run from this directory

```sh
pnpm install
pnpm --dir ../.. build
pnpm dev
```

## AI iteration

Commenting works without extra setup. To try agent iterations, configure
credentials from the root [README](../../README.md#ai-iteration) or
[`.env.example`](../../.env.example).
