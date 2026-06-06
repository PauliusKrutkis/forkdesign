export const DEFAULT_FIX_SKILLS = ["frontend-design"] as const;

export const FIX_SKILLS = ["frontend-design"] as const;

export type FixSkill = (typeof FIX_SKILLS)[number];

const FIX_SKILL_SET = new Set<string>(FIX_SKILLS);

const FRONTEND_DESIGN_GUIDANCE = [
  "## Skill: frontend-design",
  "Use this skill when feedback asks for UI, visual design, layout, styling, polish, or React component changes.",
  "- Choose an intentional visual direction instead of generic AI defaults.",
  "- Respect the app's existing design system, Tailwind/shadcn tokens, and local component patterns.",
  "- Improve typography, spacing, color, hierarchy, motion, and composition when they help the feedback.",
  "- Keep the edit scoped to the anchored UI unless the comment clearly asks for a broader design pass.",
  "- Avoid cliched purple gradients, generic card layouts, and unnecessary visual churn.",
] as const;

export function parseFixSkill(value: string): FixSkill | undefined {
  return FIX_SKILL_SET.has(value) ? (value as FixSkill) : undefined;
}

export function buildFixSkillPromptSection(
  skills: readonly FixSkill[]
): string[] {
  if (!skills.includes("frontend-design")) {
    return [];
  }
  return [...FRONTEND_DESIGN_GUIDANCE];
}
