# Demo recording

Two Playwright recorders drive the overlay and capture a webm; ffmpeg converts
each to a README GIF. Shared cursor/click helpers live in
[`lib/driver.mjs`](./lib/driver.mjs).

| Script | Records | Output |
| --- | --- | --- |
| `record-gif.mjs` | The commenting flow (writes a real JSX marker) | `docs/assets/forkdesign-demo.gif` |
| `record-versions-gif.mjs` | Flipping between agent versions (fully mocked, no agent) | `docs/assets/forkdesign-versions.gif` |

`record-versions-gif.mjs` needs no agent and writes nothing to disk: it stubs
the iterations API (`/api/comments`, `/api/iterations*`) so one comment already
has three on-disk versions, then clicks between the variant cards. The variant
thumbnails are inline SVG mocks of the hero, and the live headline is swapped to
match the selected version.

## Regenerate

```sh
# 1. Run the example dev server
pnpm install && pnpm build
pnpm --dir examples/basic-vite dev --port 5188

# 2. Record (needs playwright + a chromium browser available)
URL=http://localhost:5188/ OUT=/tmp/fd-gif node scripts/demo/record-gif.mjs
URL=http://localhost:5188/ OUT=/tmp/fd-versions node scripts/demo/record-versions-gif.mjs

# 3a. Commenting flow: webm -> gif
WEBM=$(ls /tmp/fd-gif/video/*.webm | head -1)
ffmpeg -y -ss 0.2 -i "$WEBM" -vf "setpts=PTS/1.25,fps=15,scale=880:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" /tmp/fd-gif/pal.png
ffmpeg -y -ss 0.2 -i "$WEBM" -i /tmp/fd-gif/pal.png \
  -lavfi "setpts=PTS/1.25,fps=15,scale=880:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=2" \
  docs/assets/forkdesign-demo.gif

# 3b. Version switching: webm -> gif
WEBM=$(ls /tmp/fd-versions/video/*.webm | head -1)
ffmpeg -y -ss 0.8 -i "$WEBM" -vf "setpts=PTS/1.2,fps=15,scale=880:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" /tmp/fd-versions/pal.png
ffmpeg -y -ss 0.8 -i "$WEBM" -i /tmp/fd-versions/pal.png \
  -lavfi "setpts=PTS/1.2,fps=15,scale=880:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=2" \
  docs/assets/forkdesign-versions.gif
```

`record-gif.mjs` writes a comment marker into `examples/basic-vite/src/app.tsx`;
restore it afterward with `git checkout examples/basic-vite/src/`.
