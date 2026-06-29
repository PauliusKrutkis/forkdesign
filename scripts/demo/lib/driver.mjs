// Shared Playwright recording driver for the demo scripts. Spins up a browser
// recording a webm, draws a synthetic cursor (Playwright video shows none), and
// exposes eased glide/move/click helpers so the recordings read as real use.
import { chromium } from "@playwright/test";

/**
 * Injected into every page: a fake cursor that follows real mouse moves and
 * nudges on mousedown. Playwright's recorded video has no pointer of its own,
 * so without this the recordings look like the UI moves on its own.
 */
function drawSyntheticCursor() {
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
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
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
}

/**
 * Launch a recording browser and return the page plus cursor-driving helpers.
 * Call `finish()` to flush the video and close everything.
 */
export async function createRecorder({ out, width = 1280, height = 800 } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: { dir: `${out}/video`, size: { width, height } },
  });
  await context.addInitScript(drawSyntheticCursor);

  const page = await context.newPage();

  let cx = width / 2;
  let cy = height / 2;
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

  async function settleCursor() {
    await page.mouse.move(cx, cy);
  }

  async function finish() {
    await context.close(); // flush video
    await browser.close();
  }

  return {
    browser,
    context,
    page,
    sleep,
    glide,
    moveTo,
    click,
    settleCursor,
    finish,
    width,
    height,
  };
}
