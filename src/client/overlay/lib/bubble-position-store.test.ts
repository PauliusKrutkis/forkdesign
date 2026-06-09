import { beforeEach, describe, expect, it } from "vitest";
import {
  clampPositionIntoView,
  clearBubblePosition,
  loadBubblePosition,
  saveBubblePosition,
} from "./bubble-position-store.ts";

// happy-dom doesn't ship a usable localStorage, so back it with a plain Map.
function installMemoryStorage(): void {
  const map = new Map<string, string>();
  const store: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, String(v));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: store,
  });
}

beforeEach(() => {
  installMemoryStorage();
});

describe("bubble position persistence", () => {
  it("round-trips a saved position", () => {
    saveBubblePosition("abc", { left: 120, top: 64 });
    expect(loadBubblePosition("abc")).toEqual({ left: 120, top: 64 });
  });

  it("scopes positions per comment id", () => {
    saveBubblePosition("a", { left: 10, top: 10 });
    saveBubblePosition("b", { left: 99, top: 99 });
    expect(loadBubblePosition("a")).toEqual({ left: 10, top: 10 });
    expect(loadBubblePosition("b")).toEqual({ left: 99, top: 99 });
  });

  it("clears a saved position", () => {
    saveBubblePosition("abc", { left: 1, top: 2 });
    clearBubblePosition("abc");
    expect(loadBubblePosition("abc")).toBeNull();
  });

  it("ignores an empty comment id", () => {
    saveBubblePosition("", { left: 1, top: 2 });
    expect(loadBubblePosition("")).toBeNull();
  });

  it("returns null for unknown ids and corrupt entries", () => {
    expect(loadBubblePosition("missing")).toBeNull();
    window.localStorage.setItem("bubble-pos:bad", "not json");
    expect(loadBubblePosition("bad")).toBeNull();
    window.localStorage.setItem(
      "bubble-pos:partial",
      JSON.stringify({ left: 5 })
    );
    expect(loadBubblePosition("partial")).toBeNull();
  });
});

describe("clampPositionIntoView", () => {
  const viewport = { width: 1000, height: 800 };
  const width = 384;

  it("leaves an in-bounds position untouched", () => {
    expect(
      clampPositionIntoView({ left: 200, top: 200 }, viewport, width)
    ).toEqual({ left: 200, top: 200 });
  });

  it("keeps a slice on-screen when dragged far right/down", () => {
    const clamped = clampPositionIntoView(
      { left: 5000, top: 5000 },
      viewport,
      width
    );
    // At least MIN_VISIBLE (120) px of the panel stays reachable.
    expect(clamped.left).toBe(viewport.width - 120);
    expect(clamped.top).toBe(viewport.height - 120);
  });

  it("pins the header below the top edge and allows hanging off the left", () => {
    const clamped = clampPositionIntoView(
      { left: -5000, top: -5000 },
      viewport,
      width
    );
    expect(clamped.left).toBe(120 - width);
    expect(clamped.top).toBe(8);
  });
});
