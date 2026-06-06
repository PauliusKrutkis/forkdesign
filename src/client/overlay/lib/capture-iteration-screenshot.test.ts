import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  anchorRenderSignature,
  captureAgentVariantScreenshots,
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

describe("captureAgentVariantScreenshots", () => {
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

  it("re-applies the active iteration before capturing its screenshot", async () => {
    const requests: Array<{ body: unknown; url: string }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? "{}")) as { v?: number };
        requests.push({ url, body });

        if (url === "/api/iterations/activate" && body.v === 1) {
          const anchor = document.querySelector("[data-comment-anchor]");
          if (anchor) {
            anchor.textContent = "new";
          }
        }

        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        );
      })
    );

    await captureAgentVariantScreenshots({
      id: "comment-1",
      anchor: "anchor-1",
      versions: [1],
      activeV: 1,
      initialPreviousSignature: anchorRenderSignature("anchor-1"),
    });

    expect(requests.map((request) => request.url)).toEqual([
      "/api/iterations/activate",
      "/api/iterations/screenshot",
    ]);
    expect(htmlToImageMock.capturedText).toEqual(["new"]);
  });
});
