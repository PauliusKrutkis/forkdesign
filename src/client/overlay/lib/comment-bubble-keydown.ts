import type { Dispatch, SetStateAction } from "react";
import type { CommentData } from "../../types.ts";
import type { BubbleMode } from "../hooks/use-iterate-fix.ts";
import { ignorePromiseRejection } from "./ignore-promise-rejection.ts";

export interface CommentBubbleKeydownContext {
  cancelDeleteConfirm: () => void;
  cancelEditing: () => void;
  cancelReply: () => void;
  confirmDelete: () => Promise<void>;
  deleteConfirming: boolean;
  editing: boolean;
  handleIterate: () => Promise<void>;
  iterating: boolean;
  lead: CommentData;
  lightboxSrc: string | null;
  onClose: () => void;
  onDelete?: (id: string) => Promise<void>;
  onEdit?: (id: string, text: string) => Promise<void>;
  onResolve?: (id: string) => void;
  onSubmitReply?: (id: string, text: string, v?: number) => Promise<void>;
  openReplyComposer: () => void;
  replyOpen: boolean;
  requestDelete: () => void;
  setLightboxSrc: (src: string | null) => void;
  setMode: Dispatch<SetStateAction<BubbleMode>>;
  startEditing: () => void;
}

function isTypingInField(active: Element | null): boolean {
  return (
    active !== null &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      (active instanceof HTMLElement && active.isContentEditable))
  );
}

function handleEscapeKey(
  e: KeyboardEvent,
  ctx: CommentBubbleKeydownContext
): boolean {
  const {
    cancelDeleteConfirm,
    cancelEditing,
    cancelReply,
    deleteConfirming,
    editing,
    lightboxSrc,
    onClose,
    replyOpen,
    setLightboxSrc,
  } = ctx;

  if (e.key !== "Escape") {
    return false;
  }

  if (lightboxSrc) {
    setLightboxSrc(null);
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
  if (deleteConfirming) {
    cancelDeleteConfirm();
    e.preventDefault();
    return true;
  }
  if (replyOpen) {
    cancelReply();
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
  if (editing) {
    cancelEditing();
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
  onClose();
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
  const plain = !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey);
  const key = e.key.toLowerCase();
  if (plain && key === "enter") {
    e.preventDefault();
    ctx.confirmDelete().catch(ignorePromiseRejection);
    return true;
  }
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
  const key = e.key.toLowerCase();
  if (mod && key === "i") {
    e.preventDefault();
    if (!ctx.iterating) {
      ctx.handleIterate().catch(ignorePromiseRejection);
    }
    return true;
  }
  if (mod && key === "r") {
    e.preventDefault();
    ctx.onResolve?.(ctx.lead.id);
    return true;
  }
  if (mod && e.key === "Backspace" && ctx.onDelete) {
    e.preventDefault();
    ctx.requestDelete();
    return true;
  }
  return false;
}

function handlePlainShortcuts(
  e: KeyboardEvent,
  ctx: CommentBubbleKeydownContext
): boolean {
  const plain = !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey);
  const key = e.key.toLowerCase();
  if (plain && key === "e" && ctx.onEdit) {
    e.preventDefault();
    ctx.startEditing();
    return true;
  }
  if (plain && key === "r" && ctx.onSubmitReply) {
    e.preventDefault();
    ctx.openReplyComposer();
    return true;
  }
  if (e.key === "Tab") {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
      return false;
    }
    e.preventDefault();
    ctx.setMode((prev) => (prev === "compact" ? "detailed" : "compact"));
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
  if (isTypingInField(document.activeElement)) {
    return;
  }
  if (handleDeleteConfirmKeys(e, ctx)) {
    return;
  }
  if (handleModifierShortcuts(e, ctx)) {
    return;
  }
  handlePlainShortcuts(e, ctx);
}
