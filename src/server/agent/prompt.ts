import path from "node:path";
import { type AgentSkill, buildAgentSkillPromptSection } from "./skills.ts";

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
  /** Summaries of earlier variants in this multi-agent batch (variant 2+). */
  priorVariantApproaches?: string[];
  projectRoot: string;
  replies?: PromptReply[];
  screenshot?: string;
  skills?: AgentSkill[];
  text: string;
  variantCount?: number;
  variantIndex?: number;
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

const VARIANT_CREATIVE_HINTS = [
  "Interpret conservatively — minimal change that satisfies the feedback.",
  "Interpret boldly — stronger visual emphasis while staying on-brand.",
  "Try a different mechanism (e.g. typography instead of color, spacing instead of border).",
  "Explore a subtle, refined treatment.",
  "Explore a high-contrast or attention-grabbing treatment.",
] as const;

const MAX_DIFF_SUMMARY_LINES = 3;
const MAX_DIFF_LINE_CHARS = 120;

/** Short description of what changed between two source snapshots (for variant dedup). */
export function summarizeAgentSourceDiff(
  before: string,
  after: string
): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  const changed: string[] = [];
  for (let i = 0; i < maxLen && changed.length < MAX_DIFF_SUMMARY_LINES; i++) {
    const beforeLine = beforeLines[i] ?? "";
    const afterLine = afterLines[i] ?? "";
    if (beforeLine !== afterLine) {
      const snippet = (afterLine.trim() || beforeLine.trim()).slice(
        0,
        MAX_DIFF_LINE_CHARS
      );
      if (snippet) {
        changed.push(snippet);
      }
    }
  }
  if (changed.length === 0) {
    return "source changed";
  }
  return changed.join("; ");
}

function variantCreativeHint(variantIndex: number): string {
  return VARIANT_CREATIVE_HINTS[
    (variantIndex - 1) % VARIANT_CREATIVE_HINTS.length
  ] as string;
}

function buildMultiVariantSection(input: PromptInput): string[] {
  const count = input.variantCount ?? 1;
  const index = input.variantIndex ?? 1;
  if (count <= 1) {
    return [];
  }

  const lines = [
    "## Multi-variant run",
    `This is variant **${index} of ${count}**. The user wants **independent design alternatives** to compare — not repeats of the same change.`,
    variantCreativeHint(index),
    "Produce a **visually distinct** solution that still satisfies the feedback. Use a different valid approach when possible (colors, spacing, typography, borders, layout).",
  ];

  const prior = input.priorVariantApproaches?.filter(Boolean) ?? [];
  if (prior.length > 0) {
    lines.push(
      "",
      "Earlier variants in this batch already tried:",
      ...prior.map((entry) => `- ${entry}`),
      "",
      "Do **not** repeat those approaches — choose a meaningfully different valid interpretation."
    );
  }

  return lines;
}

function buildConstraintsSection(input: PromptInput): string[] {
  const multiVariant = (input.variantCount ?? 1) > 1;
  const editGuidance = multiVariant
    ? "- Prefer a focused edit on the anchored element, but explore a **distinct valid interpretation** — not the same className tweak as other variants."
    : "- Make the smallest possible edit (often one className or prop).";

  return [
    "## Constraints (from CLAUDE.md and the comment-bubble system)",
    "- Do NOT remove or modify the `{/* @comment ... */}` block — it's preserved human feedback.",
    "- Do NOT change the `data-comment-anchor` attribute value.",
    "- Follow the host app's existing Tailwind/shadcn tokens (`bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`, etc.).",
    editGuidance,
    "- After one successful Edit, stop immediately — do not re-read the file or verify.",
    "- Don't run tests or builds — the user verifies visually.",
  ];
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

  const skillSection = buildAgentSkillPromptSection(input.skills ?? []);
  if (skillSection.length > 0) {
    parts.push("", ...skillSection);
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

  const multiVariant = buildMultiVariantSection(input);
  if (multiVariant.length > 0) {
    parts.push("", ...multiVariant);
  }

  parts.push(
    "",
    ...buildConstraintsSection(input),
    "",
    "Now read the file, locate the element by its anchor, apply the change, and stop."
  );

  return parts.join("\n");
}
