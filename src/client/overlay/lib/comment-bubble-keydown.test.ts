import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentData } from "../../types.ts";
import {
  type CommentBubbleKeydownContext,
  handleCommentBubbleKeydown,
} from "./comment-bubble-keydown.ts";

const lead: CommentData = {
  id: "comment-1",
  anchor: "anchor-1",
  author: "alice@example.com",
  date: "2026-01-01T00:00:00.000Z",
  text: "Please adjust this",
};

function createContext(
  overrides: Partial<CommentBubbleKeydownContext> = {}
): CommentBubbleKeydownContext {
  return {
    cancelDeleteConfirm: vi.fn(),
    confirmDelete: vi.fn(async () => undefined),
    deleteConfirming: true,
    lead,
    lightboxSrc: null,
    onClose: vi.fn(),
    requestDelete: vi.fn(),
    setLightboxSrc: vi.fn(),
    ...overrides,
  };
}

describe("handleCommentBubbleKeydown", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("leaves plain Enter alone while delete confirm is open", () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.focus();
    const ctx = createContext();
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });

    handleCommentBubbleKeydown(event, ctx);

    expect(ctx.confirmDelete).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("confirms delete with Ctrl+Backspace while textarea is focused", () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.focus();
    const ctx = createContext();
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "Backspace",
    });

    handleCommentBubbleKeydown(event, ctx);

    expect(ctx.confirmDelete).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
