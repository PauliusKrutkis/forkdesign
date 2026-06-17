// Records the forkdesign commenting flow as a webm (convert to GIF with ffmpeg).
// Usage: URL=http://localhost:5188/ OUT=/tmp/fd-gif node scripts/demo/record-gif.mjs
import { createRecorder } from "./lib/driver.mjs";

const URL = process.env.URL ?? "http://localhost:5188/";
const OUT = process.env.OUT ?? "/tmp/fd-gif";

const { page, sleep, moveTo, click, settleCursor, finish } =
  await createRecorder({ out: OUT });

await page.goto(URL, { waitUntil: "networkidle" });
await page
  .getByRole("button", { name: "forkdesign comments" })
  .waitFor({ state: "visible" });
await settleCursor();
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

await finish();
console.log("done");
