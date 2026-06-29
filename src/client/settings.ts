/**
 * Persisted user-facing settings for the comment overlay. Read on mount,
 * written on every change. The overlay state is the runtime source of truth
 * — this module is just a defensive (de)serializer over `localStorage`.
 */

import type { AgentModel } from "../shared/agent-model.ts";

export type OverlayPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";

export const OVERLAY_AGENT_MODELS = [
  "composer-2.5-fast",
  "composer-2.5",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const satisfies readonly AgentModel[];

export type OverlayModel = (typeof OVERLAY_AGENT_MODELS)[number];

export const OVERLAY_MODEL_OPTIONS: ReadonlyArray<{
  value: OverlayModel;
  label: string;
  shortLabel: string;
}> = [
  {
    value: "composer-2.5-fast",
    label: "composer-2.5-fast (Cursor CLI)",
    shortLabel: "2.5 fast",
  },
  {
    value: "composer-2.5",
    label: "composer-2.5 (Cursor CLI)",
    shortLabel: "2.5",
  },
  {
    value: "claude-sonnet-4-6",
    label: "claude-sonnet-4-6",
    shortLabel: "sonnet 4.6",
  },
  {
    value: "claude-opus-4-7",
    label: "claude-opus-4-7",
    shortLabel: "opus 4.7",
  },
];

const VALID_OVERLAY_MODELS: ReadonlySet<AgentModel> = new Set(
  OVERLAY_AGENT_MODELS
);

export interface OverlaySettings {
  author: string;
  enabled: boolean;
  hideResolved: boolean;
  model: OverlayModel;
  position: OverlayPosition;
  showFloatingControls: boolean;
  skipDeleteConfirmation: boolean;
}

const DEFAULT_SETTINGS: OverlaySettings = {
  enabled: true,
  showFloatingControls: true,
  position: "bottom-right",
  author: "",
  model: "composer-2.5-fast",
  skipDeleteConfirmation: false,
  hideResolved: false,
};

const STORAGE_KEY = "overlay.settings";

const VALID_POSITIONS: ReadonlySet<OverlayPosition> = new Set([
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
]);

/**
 * Load settings from localStorage. Any malformed/missing field falls back to
 * its default so the caller never has to defend against partial state.
 */
export function loadSettings(): OverlaySettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_SETTINGS };
  }
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!raw) {
    return { ...DEFAULT_SETTINGS };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_SETTINGS };
  }
  const obj = parsed as Record<string, unknown>;

  const enabled =
    typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_SETTINGS.enabled;
  const position =
    typeof obj.position === "string" &&
    VALID_POSITIONS.has(obj.position as OverlayPosition)
      ? (obj.position as OverlayPosition)
      : DEFAULT_SETTINGS.position;
  const author =
    typeof obj.author === "string" ? obj.author : DEFAULT_SETTINGS.author;
  const showFloatingControls =
    typeof obj.showFloatingControls === "boolean"
      ? obj.showFloatingControls
      : DEFAULT_SETTINGS.showFloatingControls;
  const skipDeleteConfirmation =
    typeof obj.skipDeleteConfirmation === "boolean"
      ? obj.skipDeleteConfirmation
      : DEFAULT_SETTINGS.skipDeleteConfirmation;
  const hideResolved =
    typeof obj.hideResolved === "boolean"
      ? obj.hideResolved
      : DEFAULT_SETTINGS.hideResolved;
  const model =
    typeof obj.model === "string" &&
    VALID_OVERLAY_MODELS.has(obj.model as AgentModel)
      ? (obj.model as OverlayModel)
      : DEFAULT_SETTINGS.model;

  return {
    enabled,
    showFloatingControls,
    position,
    author,
    model,
    skipDeleteConfirmation,
    hideResolved,
  };
}

export function saveSettings(s: OverlaySettings): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota, private mode, etc. — settings stay session-only. */
  }
}

/**
 * Tailwind utility classes for the four anchor corners. Centralised so the
 * overlay toggle and the settings panel can share the same map.
 */
export const POSITION_CLASSES: Record<OverlayPosition, string> = {
  "bottom-right": "bottom-6 right-6 items-end",
  "bottom-left": "bottom-6 left-6 items-start",
  "top-right": "top-6 right-6 items-end",
  "top-left": "top-6 left-6 items-start",
};
