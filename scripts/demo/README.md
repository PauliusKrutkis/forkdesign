# Demo recording

`record-gif.mjs` drives the commenting flow with Playwright and records a webm;
ffmpeg converts it to the README GIF (`docs/assets/forkdesign-demo.gif`).

## Regenerate

```sh
# 1. Run the example dev server
pnpm install && pnpm build
pnpm --dir examples/basic-vite dev --port 5188

# 2. Record (needs playwright + a chromium browser available)
URL=http://localhost:5188/ OUT=/tmp/fd-gif node scripts/demo/record-gif.mjs

# 3. Convert webm -> gif
WEBM=$(ls /tmp/fd-gif/video/*.webm | head -1)
ffmpeg -y -ss 0.2 -i "$WEBM" -vf "setpts=PTS/1.25,fps=15,scale=880:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" /tmp/fd-gif/pal.png
ffmpeg -y -ss 0.2 -i "$WEBM" -i /tmp/fd-gif/pal.png \
  -lavfi "setpts=PTS/1.25,fps=15,scale=880:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=2" \
  docs/assets/forkdesign-demo.gif
```

The script writes a comment marker into `examples/basic-vite/src/main.tsx`;
restore it afterward with `git checkout examples/basic-vite/src/`.
