// Records the forkdesign version-switching flow as a webm (convert to GIF with
// ffmpeg). This one needs no agent and no source writes: it mocks the iterations
// API so a comment already has three on-disk versions, then flips between them.
// Each version is a genuinely different design of the commented hero component,
// so switching visibly redesigns the page — not just its text.
//
// Usage: URL=http://localhost:5188/ OUT=/tmp/fd-versions node scripts/demo/record-versions-gif.mjs
import { createRecorder } from "./lib/driver.mjs";

const URL = process.env.URL ?? "http://localhost:5188/";
const OUT = process.env.OUT ?? "/tmp/fd-versions";

// One comment anchored to the hero headline, with two agent-generated variants
// (v1, v2) on top of the baseline (v0) — three cards in the grid.
const ANCHOR = "11111111-2222-4333-8444-555555555555";
const ID = ANCHOR;
const AUTHOR = "dev@local";
const NOW = Date.now();
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const PNG_VERSION_RE = /v(\d)\.png/;

// Three distinct hero designs. Each spec drives both the variant thumbnail (SVG
// mock) and the live restyle applied to the running component on switch.
const VARIANTS = [
  {
    v: 0,
    label: "Original",
    eyebrow: "ForkDesign example",
    eyebrowColor: "#6d28d9",
    cardBg: "#ffffff",
    cardStroke: "#e4e4e7",
    headColor: "#18181b",
    weight: 600,
    ledeColor: "#71717a",
    primaryBg: "#18181b",
    primaryColor: "#ffffff",
    secondaryBg: "#ffffff",
    secondaryColor: "#18181b",
    secondaryStroke: "#d4d4d8",
    headSize: 18,
    headSvg: ["Review your running UI", "without leaving the browser."],
    lede: "Click the ForkDesign button, select",
    liveHead: "Review your running UI without leaving the browser.",
    liveSize: "",
  },
  {
    v: 1,
    label: "v2",
    eyebrow: "ForkDesign",
    eyebrowColor: "#a78bfa",
    cardBg: "#09090b",
    cardStroke: "#09090b",
    headColor: "#ffffff",
    weight: 800,
    ledeColor: "#a1a1aa",
    primaryBg: "#ffffff",
    primaryColor: "#09090b",
    secondaryBg: "transparent",
    secondaryColor: "#fafafa",
    secondaryStroke: "#3f3f46",
    headSize: 24,
    headSvg: ["Review your UI in", "the browser."],
    lede: "Comment, get variants, ship the diff.",
    liveHead: "Review your UI in\nthe browser.",
    liveSize: "clamp(36px, 5vw, 60px)",
  },
  {
    v: 2,
    label: "v3",
    eyebrow: "ForkDesign",
    eyebrowColor: "#ede9fe",
    gradient: ["#7c3aed", "#4c1d95"],
    cardStroke: "#5b21b6",
    headColor: "#ffffff",
    weight: 800,
    ledeColor: "#ede9fe",
    primaryBg: "#ffffff",
    primaryColor: "#4c1d95",
    secondaryBg: "rgba(255,255,255,0.16)",
    secondaryColor: "#ffffff",
    secondaryStroke: "rgba(255,255,255,0.4)",
    headSize: 25,
    headSvg: ["See it. Comment it.", "Ship the diff."],
    lede: "Local-first iteration. Every change is git.",
    liveHead: "See it. Comment it.\nShip the diff.",
    liveSize: "clamp(36px, 5vw, 60px)",
  },
];

/** A small SVG mock of the hero in a given design — stands in for a screenshot. */
function variantSvg(d) {
  const gradient = d.gradient
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d.gradient[0]}"/><stop offset="1" stop-color="${d.gradient[1]}"/></linearGradient></defs>`
    : "";
  const cardFill = d.gradient ? "url(#g)" : d.cardBg;
  const lineGap = d.headSize + 5;
  const headTop = 74;
  const heads = d.headSvg
    .map((line, i) => {
      const y = headTop + i * lineGap;
      return `<text x="40" y="${y}" font-size="${d.headSize}" font-weight="${d.weight}" letter-spacing="-1" fill="${d.headColor}">${line}</text>`;
    })
    .join("");
  const ledeY = headTop + d.headSvg.length * lineGap + 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" font-family="Inter, system-ui, sans-serif">
  ${gradient}
  <rect width="320" height="200" fill="#f4f4f5"/>
  <rect x="12" y="10" width="296" height="180" rx="18" fill="${cardFill}" stroke="${d.cardStroke}"/>
  <text x="40" y="48" font-size="9" font-weight="700" letter-spacing="1.4" fill="${d.eyebrowColor}">${d.eyebrow.toUpperCase()}</text>
  ${heads}
  <text x="40" y="${ledeY}" font-size="11" fill="${d.ledeColor}">${d.lede}</text>
  <rect x="40" y="${ledeY + 14}" width="78" height="22" rx="11" fill="${d.primaryBg}"/>
  <text x="79" y="${ledeY + 29}" font-size="9.5" fill="${d.primaryColor}" text-anchor="middle">Start review</text>
  <rect x="126" y="${ledeY + 14}" width="74" height="22" rx="11" fill="${d.secondaryBg}" stroke="${d.secondaryStroke}"/>
  <text x="163" y="${ledeY + 29}" font-size="9.5" fill="${d.secondaryColor}" text-anchor="middle">View source</text>
</svg>`;
}

const { page, sleep, click, settleCursor, finish } = await createRecorder({
  out: OUT,
});

// --- Mock the dev-server API so the flow is fully local: no agent, no writes.

let activeVersion = 0;

await page.route("**/api/comments", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      comments: [
        {
          id: ID,
          anchor: ANCHOR,
          author: AUTHOR,
          date: iso(-90 * 1000),
          text: "Tighten this headline — two lines max, and bump the contrast.",
          active: 0,
          view: "hero",
          route: "/",
        },
      ],
    }),
  })
);

await page.route("**/api/iterations/runs", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ runs: [] }),
  })
);

await page.route("**/api/iterations/activate", async (route) => {
  try {
    const body = JSON.parse(route.request().postData() ?? "{}");
    if (typeof body.v === "number") {
      activeVersion = body.v;
    }
  } catch {
    /* ignore */
  }
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ active: activeVersion }),
  });
});

await page.route(/\/api\/iterations\?/, (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: ID,
      file: "examples/basic-vite/src/app.tsx",
      active: activeVersion,
      versions: [
        {
          v: 0,
          png: `/designs/iterations/${ID}/v0.png`,
          createdAt: iso(-90 * 1000),
        },
        {
          v: 1,
          runId: "run-1",
          summary: "Dark, high-contrast, two-line headline.",
          png: `/designs/iterations/${ID}/v1.png`,
          createdAt: iso(-30 * 1000),
        },
        {
          v: 2,
          runId: "run-1",
          summary: "Bold gradient hero, punchy three-beat headline.",
          png: `/designs/iterations/${ID}/v2.png`,
          createdAt: iso(-29 * 1000),
        },
      ],
    }),
  })
);

await page.route(
  new RegExp(`/designs/iterations/${ID}/v(\\d)\\.png`),
  (route) => {
    const match = route.request().url().match(PNG_VERSION_RE);
    const v = match ? Number(match[1]) : 0;
    route.fulfill({
      contentType: "image/svg+xml",
      body: variantSvg(VARIANTS[v] ?? VARIANTS[0]),
    });
  }
);

// Restyle the live hero component to the selected design, so switching versions
// visibly redesigns the page (background, type, buttons) — not just the text.
async function applyVariant(v) {
  const design = VARIANTS[v] ?? VARIANTS[0];
  await page.evaluate((d) => {
    const hero = document.querySelector(".hero");
    if (!(hero instanceof HTMLElement)) {
      return;
    }
    const eyebrow = hero.querySelector(".eyebrow");
    const h1 = hero.querySelector("h1");
    const lede = hero.querySelector(".lede");
    const primary = hero.querySelector(".actions button");
    const secondary = hero.querySelector(".actions a");
    const ease = "320ms ease";

    hero.style.transition = `background ${ease}, border-color ${ease}`;
    hero.style.background = d.gradient
      ? `linear-gradient(135deg, ${d.gradient[0]}, ${d.gradient[1]})`
      : d.cardBg;
    hero.style.borderColor = d.cardStroke;

    if (eyebrow instanceof HTMLElement) {
      eyebrow.style.transition = `color ${ease}`;
      eyebrow.style.color = d.eyebrowColor;
    }
    if (h1 instanceof HTMLElement) {
      h1.style.transition = `color ${ease}, font-size ${ease}`;
      h1.style.whiteSpace = "pre-line";
      h1.style.color = d.headColor;
      h1.style.fontWeight = String(d.weight);
      h1.style.fontSize = d.liveSize;
      h1.textContent = d.liveHead;
    }
    if (lede instanceof HTMLElement) {
      lede.style.transition = `color ${ease}`;
      lede.style.color = d.ledeColor;
    }
    if (primary instanceof HTMLElement) {
      primary.style.transition = `background ${ease}, color ${ease}`;
      primary.style.background = d.primaryBg;
      primary.style.color = d.primaryColor;
    }
    if (secondary instanceof HTMLElement) {
      secondary.style.transition = `background ${ease}, color ${ease}, border-color ${ease}`;
      secondary.style.background = d.secondaryBg;
      secondary.style.color = d.secondaryColor;
      secondary.style.borderColor = d.secondaryStroke;
    }
  }, design);
  await sleep(340);
}

await page.goto(URL, { waitUntil: "networkidle" });
await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible" });

// Tag the headline as the comment's anchor so its pin renders there.
await page
  .getByRole("heading", { level: 1 })
  .evaluate(
    (el, anchor) => el.setAttribute("data-comment-anchor", anchor),
    ANCHOR
  );

const pin = page.getByRole("button", { name: /comment by/ });
await pin.waitFor({ state: "visible" });
await settleCursor();
await sleep(1000);

// 1. Open the existing comment thread.
await click(pin);
await page
  .getByRole("button", { name: "Use v2" })
  .waitFor({ state: "visible" });
await sleep(900);

// 2. Flip to the first agent variant (dark, high-contrast redesign).
await click(page.getByRole("button", { name: "Use v2" }));
await applyVariant(1);
await sleep(1200);

// 3. Flip to the second (bold gradient redesign).
await click(page.getByRole("button", { name: "Use v3" }));
await applyVariant(2);
await sleep(1200);

// 4. Settle back on the one we like.
await click(page.getByRole("button", { name: "Use v2" }));
await applyVariant(1);
await sleep(1500);

await finish();
console.log("done");
