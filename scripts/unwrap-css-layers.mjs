import { readFile, writeFile } from "node:fs/promises";
import postcss from "postcss";

const file = process.argv[2];

if (!file) {
  throw new Error("Usage: node scripts/unwrap-css-layers.mjs <css-file>");
}

const css = await readFile(file, "utf8");
const root = postcss.parse(css, { from: file });

root.walkAtRules("layer", (rule) => {
  if (rule.nodes?.length) {
    rule.replaceWith(...rule.nodes);
    return;
  }
  rule.remove();
});

await writeFile(file, root.toString(), "utf8");
