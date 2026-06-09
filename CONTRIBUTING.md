# Contributing

Thanks for taking a look at design-crit.

## Local setup

```sh
pnpm install
pnpm test
pnpm build
```

Before opening a pull request, run:

```sh
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

## Development notes

- Keep browser code under `src/client/` free of Node-only imports.
- Keep Vite middleware and filesystem work under `src/server/`.
- Public imports should go through `design-crit` and `design-crit/plugin`.
- Add focused colocated tests for parser, writer, API, and iteration behavior.

Design Crit writes local iteration artifacts under `designs/` in host apps. Avoid
committing those artifacts unless you intentionally want design history in git.
