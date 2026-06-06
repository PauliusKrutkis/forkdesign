import type { CommentData } from "../../types.ts";
import { ignorePromiseRejection } from "./ignore-promise-rejection.ts";

/**
 * Hotkeys for the open bubble. With an always-focused composer, plain
 * single-key shortcuts are gone — only Escape and Cmd/Ctrl combos remain, so
 * they coexist with typing. Edit/delete of individual entries are hover
 * actions; sending is the composer's own Cmd/Ctrl+Enter. Delete confirmation
 * uses Cmd/Ctrl+Backspace so the composer can keep focus.
 */
export interface CommentBubbleKeydownContext {
  cancelDeleteConfirm: () => void;
  cancelInlineEdit?: () => void;
  confirmDelete: () => Promise<void>;
  deleteConfirming: boolean;
  editingEntryKey?: string | null;
  lead: CommentData;
  lightboxSrc: string | null;
  onClose: () => void;
  onDelete?: (
    id: string,
    options?: { revertBaseline?: boolean }
  ) => Promise<void>;
  onResolve?: (id: string) => void;
  requestDelete: () => void;
  setLightboxSrc: (src: string | null) => void;
}

function handleEscapeKey(
  e: KeyboardEvent,
  ctx: CommentBubbleKeydownContext
): boolean {
  if (e.key !== "Escape") {
    return false;
  }
  if (ctx.lightboxSrc) {
    ctx.setLightboxSrc(null);
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
  if (ctx.deleteConfirming) {
    ctx.cancelDeleteConfirm();
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
  if (ctx.editingEntryKey) {
    ctx.cancelInlineEdit?.();
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
  ctx.onClose();
  e.preventDefault();
  return true;
}

function handleDeleteConfirmKeys(
  e: KeyboardEvent,
  ctx: CommentBubbleKeydownContext
): boolean {
  if (!ctx.deleteConfirming) {
    return false;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === "Backspace") {
    e.preventDefault();
    ctx.confirmDelete().catch(ignorePromiseRejection);
    return true;
  }
  return false;
}

function handleModifierShortcuts(
  e: KeyboardEvent,
  ctx: CommentBubbleKeydownContext
): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) {
    return false;
  }
  const key = e.key.toLowerCase();
  if (key === "r") {
    e.preventDefault();
    ctx.onResolve?.(ctx.lead.id);
    return true;
  }
  if (e.key === "Backspace" && ctx.onDelete) {
    e.preventDefault();
    ctx.requestDelete();
    return true;
  }
  return false;
}

export function handleCommentBubbleKeydown(
  e: KeyboardEvent,
  ctx: CommentBubbleKeydownContext
): void {
  if (handleEscapeKey(e, ctx)) {
    return;
  }
  if (handleDeleteConfirmKeys(e, ctx)) {
    return;
  }
  handleModifierShortcuts(e, ctx);
}
