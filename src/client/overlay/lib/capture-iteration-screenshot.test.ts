import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  anchorRenderSignature,
  capturePendingVersionScreenshot,
} from "./capture-iteration-screenshot.ts";

const htmlToImageMock = vi.hoisted(() => {
  const capturedText: string[] = [];
  return {
    capturedText,
    toPng: vi.fn((node: HTMLElement) => {
      capturedText.push(node.textContent ?? "");
      return Promise.resolve("data:image/png;base64,AAA");
    }),
  };
});

vi.mock("html-to-image", () => ({
  toPng: htmlToImageMock.toPng,
}));

describe("capturePendingVersionScreenshot", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML =
      '<button data-comment-anchor="anchor-1">current</button>';
    htmlToImageMock.capturedText.length = 0;
    htmlToImageMock.toPng.mockClear();
    const requestAnimationFrame = (callback: FrameRequestCallback) => {
      window.setTimeout(() => callback(performance.now()), 0);
      return 1;
    };
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    window.requestAnimationFrame = requestAnimationFrame;
  });

  it("captures the live render and uploads without activating source", async () => {
    const requests: Array<{ body: unknown; url: string }> = [];
    const previousSignature = anchorRenderSignature("anchor-1");

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? "{}")) as { v?: number };
        requests.push({ url, body });

        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        );
      })
    );

    document.querySelector("[data-comment-anchor]")!.textContent = "live v2";

    await capturePendingVersionScreenshot({
      id: "comment-1",
      anchor: "anchor-1",
      v: 2,
      previousSignature,
    });

    expect(requests.map((request) => request.url)).toEqual([
      "/api/iterations/screenshot",
    ]);
    expect(htmlToImageMock.capturedText).toEqual(["live v2"]);
  });

  it("captures the anchored instance, not the first, when an element is repeated", async () => {
    document.body.innerHTML =
      '<button data-comment-anchor="anchor-1">first copy</button>' +
      '<button data-comment-anchor="anchor-1">second copy live</button>';

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        )
      )
    );

    await capturePendingVersionScreenshot({
      id: "comment-1",
      anchor: "anchor-1",
      instance: 1,
      v: 1,
    });

    expect(htmlToImageMock.capturedText).toEqual(["second copy live"]);
  });

  it("skips baseline versions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        )
      )
    );

    const uploaded = await capturePendingVersionScreenshot({
      id: "comment-1",
      anchor: "anchor-1",
      v: 0,
    });

    expect(uploaded).toBe(false);
    expect(htmlToImageMock.toPng).not.toHaveBeenCalled();
  });
});
