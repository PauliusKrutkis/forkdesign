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

  it("restores the active iteration after capturing other variants", async () => {
    const activations: number[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? "{}")) as { v?: number };

        if (url === "/api/iterations/activate" && typeof body.v === "number") {
          activations.push(body.v);
          const anchor = document.querySelector("[data-comment-anchor]");
          if (anchor) {
            anchor.textContent = `variant ${body.v}`;
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
      versions: [1, 2],
      activeV: 2,
      initialPreviousSignature: anchorRenderSignature("anchor-1"),
    });

    expect(activations).toEqual([2, 1, 2]);
    expect(htmlToImageMock.capturedText).toEqual(["variant 2", "variant 1"]);
    expect(document.querySelector("[data-comment-anchor]")?.textContent).toBe(
      "variant 2"
    );
  });

  it("captures the anchored instance, not the first, when an element is repeated", async () => {
    // A repeated element: two DOM copies share one anchor (a .map() list or a
    // shared component). The comment is anchored to the SECOND copy.
    document.body.innerHTML =
      '<button data-comment-anchor="anchor-1">first copy</button>' +
      '<button data-comment-anchor="anchor-1">second copy</button>';

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? "{}")) as { v?: number };
        if (url === "/api/iterations/activate" && body.v === 1) {
          // Source-level change re-renders every copy of the element.
          for (const el of document.querySelectorAll("[data-comment-anchor]")) {
            el.textContent = `${el.textContent} v1`;
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
      instance: 1,
      versions: [1],
      activeV: 1,
      initialPreviousSignature: anchorRenderSignature("anchor-1", 1),
    });

    // The PNG must come from the second copy (the one commented on), not the
    // first that querySelector would have grabbed.
    expect(htmlToImageMock.capturedText).toEqual(["second copy v1"]);
  });

  it("captures pending variants then restores baseline when baseline is active", async () => {
    const activations: number[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? "{}")) as { v?: number };

        if (url === "/api/iterations/activate" && typeof body.v === "number") {
          activations.push(body.v);
          const anchor = document.querySelector("[data-comment-anchor]");
          if (anchor) {
            anchor.textContent = `variant ${body.v}`;
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
      activeV: 0,
    });

    expect(activations).toEqual([1, 0]);
    expect(htmlToImageMock.capturedText).toEqual(["variant 1"]);
    expect(document.querySelector("[data-comment-anchor]")?.textContent).toBe(
      "variant 0"
    );
  });

  it("does not restore a stale active iteration after the user selects another version", async () => {
    const activations: number[] = [];
    let shouldRestoreActive = true;

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? "{}")) as { v?: number };

        if (url === "/api/iterations/activate" && typeof body.v === "number") {
          activations.push(body.v);
          const anchor = document.querySelector("[data-comment-anchor]");
          if (anchor) {
            anchor.textContent = `variant ${body.v}`;
          }
        }

        if (url === "/api/iterations/screenshot") {
          shouldRestoreActive = false;
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
      activeV: 0,
      shouldRestoreActive: () => shouldRestoreActive,
    });

    expect(activations).toEqual([1]);
    expect(document.querySelector("[data-comment-anchor]")?.textContent).toBe(
      "variant 1"
    );
  });
});
