import path from "node:path";

export interface PromptInput {
  anchor: string;
  file: string;
  projectRoot: string;
  screenshot?: string;
  text: string;
  view?: string;
}

export function buildIteratePrompt(input: PromptInput): string {
  const parts: string[] = [];

  parts.push(
    "You are addressing inline design feedback from a user in a React + Tailwind design playground.",
    "",
    "## Feedback",
    `"${input.text}"`,
    "",
    "## Location",
    `File: ${input.file}`,
    `Element anchor: \`data-comment-anchor="${input.anchor}"\``,
    "Find the element by searching for the anchor attribute in the file. Modify code AROUND that element to address the feedback."
  );

  if (input.screenshot) {
    const absScreenshot = path.join(
      input.projectRoot,
      "public",
      input.screenshot.replace(/^\//, "")
    );
    parts.push(
      "",
      "## Visual context",
      `Screenshot taken at the time of feedback: \`${absScreenshot}\``,
      "Read this image to see what the user is looking at when they wrote the feedback."
    );
  }

  if (input.view) {
    parts.push(
      "",
      "## View context",
      `The element is inside the \`data-view="${input.view}"\` region.`
    );
  }

  parts.push(
    "",
    "## Constraints (from CLAUDE.md and the comment-bubble system)",
    "- Do NOT remove or modify the `{/* @comment ... */}` block — it's preserved human feedback.",
    "- Do NOT change the `data-comment-anchor` attribute value.",
    "- Follow the host app's existing Tailwind/shadcn tokens (`bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`, etc.).",
    "- Make focused changes. Don't rewrite unrelated parts of the file.",
    "- Don't run tests or builds — the user verifies visually.",
    "",
    "Now read the file, locate the element by its anchor, and apply the changes. Once you're satisfied, stop."
  );

  return parts.join("\n");
}
