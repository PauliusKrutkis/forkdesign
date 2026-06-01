import { isInTextInput } from "./hotkeys.ts";

export interface OverlayGlobalKeydownContext {
  composerActive: boolean;
  enabled: boolean;
  openTarget: unknown;
  setComposerActive: (active: boolean) => void;
  toggleShell: (tab: "list" | "settings") => void;
}

function handleCommaKey(
  e: KeyboardEvent,
  ctx: OverlayGlobalKeydownContext
): boolean {
  if (e.key !== ",") {
    return false;
  }
  e.preventDefault();
  ctx.toggleShell("settings");
  return true;
}

function handleComposerKey(
  e: KeyboardEvent,
  ctx: OverlayGlobalKeydownContext
): boolean {
  if (e.key !== "c" && e.key !== "C") {
    return false;
  }
  if (ctx.openTarget) {
    return true;
  }
  if (ctx.composerActive) {
    e.preventDefault();
    ctx.setComposerActive(false);
    return true;
  }
  e.preventDefault();
  ctx.setComposerActive(true);
  return true;
}

function handleListKey(
  e: KeyboardEvent,
  ctx: OverlayGlobalKeydownContext
): boolean {
  if (e.key !== "l" && e.key !== "L") {
    return false;
  }
  if (ctx.composerActive || ctx.openTarget) {
    return true;
  }
  e.preventDefault();
  ctx.toggleShell("list");
  return true;
}

export function handleOverlayGlobalKeydown(
  e: KeyboardEvent,
  ctx: OverlayGlobalKeydownContext
): void {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    return;
  }
  if (isInTextInput(document.activeElement)) {
    return;
  }
  if (handleCommaKey(e, ctx)) {
    return;
  }
  if (!ctx.enabled) {
    return;
  }
  if (handleComposerKey(e, ctx)) {
    return;
  }
  handleListKey(e, ctx);
}
