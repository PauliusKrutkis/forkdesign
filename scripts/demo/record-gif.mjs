// Records the forkdesign commenting flow as a webm (convert to GIF with ffmpeg).
// Usage: URL=http://localhost:5188/ OUT=/tmp/fd-gif node record-gif.mjs
import { chromium } from "playwright";

const URL = process.env.URL ?? "http://localhost:5188/";
const OUT = process.env.OUT ?? "/tmp/fd-gif";
const W = 1280;
const H = 800;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: `${OUT}/video`, size: { width: W, height: H } },
});

// Synthetic cursor that follows real mouse moves (Playwright video shows none).
await context.addInitScript(() => {
  const draw = () => {
    if (document.getElementById("__fd_cursor")) {
      return;
    }
    const c = document.createElement("div");
    c.id = "__fd_cursor";
    c.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "width:22px",
      "height:22px",
      "z-index:2147483647",
      "pointer-events:none",
      "margin:-2px 0 0 -2px",
      "transition:transform 40ms linear",
    ].join(";");
    c.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M3 2 L3 17 L7.2 13.2 L10.2 19.5 L12.7 18.3 L9.8 12.2 L15 12 Z" ' +
      'fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    let x = window.innerWidth / 2,
      y = window.innerHeight / 2;
    document.addEventListener(
      "mousemove",
      (e) => {
        x = e.clientX;
        y = e.clientY;
        c.style.transform = `translate(${x}px, ${y}px)`;
      },
      true
    );
    document.addEventListener(
      "mousedown",
      () => {
        c.style.transform += " scale(0.8)";
      },
      true
    );
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", draw);
  } else {
    draw();
  }
});

const page = await context.newPage();

let cx = W / 2,
  cy = H / 2;
const sleep = (ms) => page.waitForTimeout(ms);
async function glide(x, y, steps = 26) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // easeInOutQuad
    await page.mouse.move(cx + (x - cx) * e, cy + (y - cy) * e);
    await sleep(10);
  }
  cx = x;
  cy = y;
}
async function moveTo(locator) {
  const b = await locator.boundingBox();
  if (!b) {
    throw new Error("no bounding box for target");
  }
  await glide(b.x + b.width / 2, b.y + b.height / 2);
  return b;
}
async function click(locator) {
  await moveTo(locator);
  await sleep(120);
  await locator.click();
  await sleep(280);
}

await page.goto(URL, { waitUntil: "networkidle" });
await page
  .getByRole("button", { name: "forkdesign comments" })
  .waitFor({ state: "visible" });
await page.mouse.move(cx, cy);
await sleep(900);

// 1. Open the forkdesign dock
await click(page.getByRole("button", { name: "forkdesign comments" }));

// 2. Start a comment
await click(page.getByText("Add comment", { exact: true }));
await sleep(300);

// 3. Pick the element to comment on
await click(page.getByRole("heading", { level: 1 }));
await sleep(400);

// 4. Switch from Agent to Comment mode
await click(page.getByRole("button", { name: /Agent/ }));
await click(page.getByRole("menuitemradio", { name: "Comment" }));
await sleep(300);

// 5. Write the feedback
const textarea = page.getByRole("textbox", { name: "Comment" });
await moveTo(textarea);
await textarea.click();
await sleep(250);
await textarea.pressSequentially(
  "Tighten this headline — two lines max, and bump the contrast.",
  { delay: 38 }
);
await sleep(500);

// 6. Send — writes a JSX marker into the source
await click(page.getByRole("button", { name: "Send comment" }));
await sleep(1600);

await context.close(); // flush video
await browser.close();
console.log("done");
