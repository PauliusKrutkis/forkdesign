import path from "node:path";

const EXPLICIT_TEXT_COLOR_RE =
  /\btext-(red|blue|green|yellow|orange|purple|pink|gray|grey|black|white|primary|foreground|muted)\b/;
const EXPLICIT_BG_COLOR_RE =
  /\bbg-(red|blue|green|yellow|orange|purple|pink|gray|grey|black|white|primary|background|muted)\b/;
const EXPLICIT_FONT_RE = /\bfont-(bold|medium|semibold|light|normal)\b/;
const EXPLICIT_LAYOUT_RE =
  /\b(padding|margin|gap|rounded|border|shadow|opacity|size|width|height)\b/;
const EXPLICIT_MAKE_CHANGE_RE =
  /\b(make|change|set|add|use)\s+(it\s+)?(red|blue|green|bold|larger|smaller|bigger)\b/;
const EXPLICIT_BACKTICK_RE = /`[^`]+`/;
const EXPLICIT_CLASS_RE = /class(?:name)?[=:\s]/;
const LEADING_SLASH_RE = /^\//;

const EXPLICIT_FEEDBACK_PATTERNS = [
  EXPLICIT_TEXT_COLOR_RE,
  EXPLICIT_BG_COLOR_RE,
  EXPLICIT_FONT_RE,
  EXPLICIT_LAYOUT_RE,
  EXPLICIT_MAKE_CHANGE_RE,
  EXPLICIT_BACKTICK_RE,
  EXPLICIT_CLASS_RE,
] as const;

export interface PromptReply {
  author: string;
  date: string;
  text: string;
  v?: number;
}

export interface PromptInput {
  activeVersion?: number;
  anchor: string;
  file: string;
  projectRoot: string;
  replies?: PromptReply[];
  screenshot?: string;
  text: string;
  view?: string;
}

/** Skip vision read when the comment text already states the change clearly. */
export function shouldIncludeScreenshotInPrompt(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length === 0) {
    return true;
  }

  return !EXPLICIT_FEEDBACK_PATTERNS.some((pattern) => pattern.test(t));
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
    `Open \`${input.file}\` and find \`data-comment-anchor="${input.anchor}"\` directly. Do not use Glob or Grep unless the anchor is missing.`,
    "Modify code AROUND that element to address the feedback."
  );

  if (input.screenshot && shouldIncludeScreenshotInPrompt(input.text)) {
    const absScreenshot = path.join(
      input.projectRoot,
      "public",
      input.screenshot.replace(LEADING_SLASH_RE, "")
    );
    parts.push(
      "",
      "## Visual context",
      `Screenshot taken at the time of feedback: \`${absScreenshot}\``,
      "Read this image only if the text feedback above is ambiguous."
    );
  }

  if (input.view) {
    parts.push(
      "",
      "## View context",
      `The element is inside the \`data-view="${input.view}"\` region.`
    );
  }

  const activeVersion = input.activeVersion ?? 0;
  const versionReplies =
    input.replies?.filter((r) => r.v === activeVersion) ?? [];
  const unversionedReplies =
    input.replies?.filter((r) => r.v === undefined) ?? [];

  if (versionReplies.length > 0) {
    parts.push(
      "",
      `## Additional feedback (on v${activeVersion + 1})`,
      ...versionReplies.map((r) => `- "${r.text}" — ${r.author}, ${r.date}`)
    );
  }

  if (unversionedReplies.length > 0) {
    parts.push(
      "",
      "## Unversioned feedback",
      ...unversionedReplies.map((r) => `- "${r.text}" — ${r.author}, ${r.date}`)
    );
  }

  parts.push(
    "",
    "## Constraints (from CLAUDE.md and the comment-bubble system)",
    "- Do NOT remove or modify the `{/* @comment ... */}` block — it's preserved human feedback.",
    "- Do NOT change the `data-comment-anchor` attribute value.",
    "- Follow the host app's existing Tailwind/shadcn tokens (`bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`, etc.).",
    "- Make the smallest possible edit (often one className or prop).",
    "- After one successful Edit, stop immediately — do not re-read the file or verify.",
    "- Don't run tests or builds — the user verifies visually.",
    "",
    "Now read the file, locate the element by its anchor, apply the change, and stop."
  );

  return parts.join("\n");
}
