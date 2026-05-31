/**
 * Persisted user-facing settings for the comment overlay. Read on mount,
 * written on every change. The overlay state is the runtime source of truth
 * — this module is just a defensive (de)serializer over `localStorage`.
 */

import type { FixModel } from "../shared/fix-model.ts";

export type OverlayPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";

/** Models exposed in overlay settings (subset of FixModel). */
export const OVERLAY_FIX_MODELS = [
  "composer-2.5-fast",
  "composer-2.5",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const satisfies readonly FixModel[];

export type OverlayModel = (typeof OVERLAY_FIX_MODELS)[number];

const VALID_OVERLAY_MODELS: ReadonlySet<FixModel> = new Set(OVERLAY_FIX_MODELS);

export interface OverlaySettings {
  /** Override for window.__COMMENT_AUTHOR__. Empty string disables override. */
  author: string;
  /** false = system fully muted (no dots/bubbles/panel, only settings access). */
  enabled: boolean;
  /** Fix model — tried first, then the server fallback chain. */
  model: OverlayModel;
  /** Which corner the dock pill anchors to. */
  position: OverlayPosition;
  /** Whether the corner dock pill renders. Hotkeys keep working when false. */
  showFloatingControls: boolean;
  /** When true, delete hotkey/button removes the comment without confirming. */
  skipDeleteConfirmation: boolean;
}

const DEFAULT_SETTINGS: OverlaySettings = {
  enabled: true,
  showFloatingControls: true,
  position: "bottom-right",
  author: "",
  model: "composer-2.5-fast",
  skipDeleteConfirmation: false,
};

const STORAGE_KEY = "redline.overlay.settings";

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
  const model =
    typeof obj.model === "string" &&
    VALID_OVERLAY_MODELS.has(obj.model as FixModel)
      ? (obj.model as OverlayModel)
      : DEFAULT_SETTINGS.model;

  return {
    enabled,
    showFloatingControls,
    position,
    author,
    model,
    skipDeleteConfirmation,
  };
}

/** Persist settings; silently no-ops if storage is unavailable. */
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
