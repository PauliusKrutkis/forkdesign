import { describe, expect, it } from "vitest";
import { dotRect, placeFloater } from "./placement";

const viewport = { width: 1000, height: 800 };
const bubble = { width: 320, height: 300 };
const padding = 12;
const gap = 8;

describe("placeFloater", () => {
  it("places below when 'bottom' preferred and there's room", () => {
    const r = placeFloater({
      anchor: { left: 500, top: 100, right: 520, bottom: 120 },
      size: bubble,
      preferredSide: "bottom",
      viewport,
    });
    expect(r.side).toBe("bottom");
    expect(r.top).toBe(120 + gap);
    // Anchor center X = 510, bubble width / 2 = 160 → left = 350
    expect(r.left).toBe(350);
  });

  it("flips to 'top' when there's no room below", () => {
    const r = placeFloater({
      anchor: { left: 500, top: 600, right: 520, bottom: 620 },
      size: bubble,
      preferredSide: "bottom",
      viewport,
    });
    expect(r.side).toBe("top");
    expect(r.top).toBe(600 - gap - bubble.height);
  });

  it("shifts left when anchor near right edge", () => {
    const r = placeFloater({
      anchor: { left: 980, top: 100, right: 990, bottom: 120 },
      size: bubble,
      preferredSide: "bottom",
      viewport,
    });
    // Without shift: anchor center 985 → left 825, right would be 1145.
    // Clamp: viewport.width - size.width - padding = 1000 - 320 - 12 = 668.
    expect(r.left).toBe(668);
  });

  it("shifts right when anchor near left edge", () => {
    const r = placeFloater({
      anchor: { left: 4, top: 100, right: 20, bottom: 120 },
      size: bubble,
      preferredSide: "bottom",
      viewport,
    });
    expect(r.left).toBe(padding);
  });

  it("arrow tracks anchor center even after the floater is shifted", () => {
    const r = placeFloater({
      anchor: { left: 980, top: 100, right: 990, bottom: 120 },
      size: bubble,
      preferredSide: "bottom",
      viewport,
    });
    // Floater left = 668. Anchor center = 985. Raw offset = 317.
    // Clamped to size.width - arrowSafePadding = 320 - 14 = 306.
    expect(r.arrowOffset).toBe(306);
  });

  it("clamps arrow offset to safe range when anchor is near the corner", () => {
    const r = placeFloater({
      anchor: { left: 0, top: 100, right: 4, bottom: 120 },
      size: bubble,
      preferredSide: "bottom",
      viewport,
    });
    // Floater left clamps to 12. Anchor center = 2. Raw offset = -10.
    // Clamped to arrowSafePadding = 14.
    expect(r.arrowOffset).toBe(14);
  });

  it("places to the right when 'right' preferred", () => {
    const r = placeFloater({
      anchor: { left: 100, top: 100, right: 120, bottom: 120 },
      size: { width: 240, height: 80 },
      preferredSide: "right",
      viewport,
    });
    expect(r.side).toBe("right");
    expect(r.left).toBe(120 + gap);
    // Anchor center Y = 110, half height = 40 → top = 70
    expect(r.top).toBe(70);
  });

  it("flips 'right' to 'left' when no room on the right", () => {
    const r = placeFloater({
      anchor: { left: 980, top: 100, right: 990, bottom: 120 },
      size: { width: 240, height: 80 },
      preferredSide: "right",
      viewport,
    });
    expect(r.side).toBe("left");
    expect(r.left).toBe(980 - gap - 240);
  });

  it("shifts cross-axis (top) to fit when right-placed near top edge", () => {
    const r = placeFloater({
      anchor: { left: 100, top: 0, right: 120, bottom: 14 },
      size: { width: 240, height: 80 },
      preferredSide: "right",
      viewport,
    });
    // Anchor center Y = 7, half height = 40 → top would be -33.
    // Clamp to padding = 12.
    expect(r.top).toBe(padding);
  });

  it("dotRect: floats on the corner when there's room", () => {
    const r = dotRect({ right: 500, top: 200 }, { width: 1000, height: 800 });
    expect(r.left).toBe(493); // 500 - 7
    expect(r.top).toBe(193); // 200 - 7
    expect(r.right - r.left).toBe(14);
  });

  it("dotRect: clamps to viewport when element touches right edge", () => {
    const r = dotRect({ right: 1000, top: 200 }, { width: 1000, height: 800 });
    expect(r.left).toBe(1000 - 14 - 12); // viewport - size - pad
    expect(r.right).toBe(988);
  });

  it("dotRect: clamps to viewport when element touches top edge", () => {
    const r = dotRect({ right: 500, top: 0 }, { width: 1000, height: 800 });
    expect(r.top).toBe(12); // pad
    expect(r.bottom).toBe(26);
  });

  it("dotRect: clamps to viewport when element touches bottom edge", () => {
    const r = dotRect({ right: 500, top: 800 }, { width: 1000, height: 800 });
    expect(r.top).toBe(800 - 14 - 12); // viewport - size - pad
  });

  it("falls through to preferred side (clamped) when neither side fits", () => {
    // Both top and bottom are too tight in a tiny viewport.
    const r = placeFloater({
      anchor: { left: 100, top: 100, right: 120, bottom: 120 },
      size: { width: 100, height: 1000 },
      preferredSide: "bottom",
      viewport,
    });
    // Neither side fits; fall through to preferred ("bottom") and overflow.
    expect(r.side).toBe("bottom");
  });
});
