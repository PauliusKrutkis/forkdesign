import { describe, expect, it } from "vitest";
import { decodeScreenshotPng } from "../../platform/media.ts";
import { parsePatchBody, parsePostBody } from "./parse-body.ts";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const validPngDataUrl = `data:image/png;base64,${PNG_SIGNATURE.toString("base64")}`;

const validPostBody = {
  file: "src/pages/Foo.tsx",
  line: 4,
  column: 7,
  text: "too heavy",
  author: "dev@local",
};

describe("parsePostBody", () => {
  it("accepts a valid body", () => {
    const result = parsePostBody(validPostBody);
    expect(result).toEqual({
      ok: true,
      value: {
        file: "src/pages/Foo.tsx",
        line: 4,
        column: 7,
        text: "too heavy",
        author: "dev@local",
      },
    });
  });

  it("accepts optional route, existingAnchor, and screenshotPng", () => {
    const result = parsePostBody({
      ...validPostBody,
      route: "/home?q=1",
      existingAnchor: "anchor-1",
      screenshotPng: validPngDataUrl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.route).toBe("/home?q=1");
      expect(result.value.existingAnchor).toBe("anchor-1");
      expect(result.value.screenshotPng).toBe(validPngDataUrl);
    }
  });

  it("trims author whitespace", () => {
    const result = parsePostBody({ ...validPostBody, author: "  dev@local  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.author).toBe("dev@local");
    }
  });

  it("rejects non-object bodies", () => {
    expect(parsePostBody(null)).toEqual({
      ok: false,
      reason: "body must be a JSON object",
    });
  });

  it("rejects empty file", () => {
    expect(parsePostBody({ ...validPostBody, file: "" })).toEqual({
      ok: false,
      reason: "field `file` must be a non-empty string",
    });
  });

  it("rejects invalid line", () => {
    expect(parsePostBody({ ...validPostBody, line: 0 })).toEqual({
      ok: false,
      reason: "field `line` must be a positive integer",
    });
  });

  it("rejects invalid column", () => {
    expect(parsePostBody({ ...validPostBody, column: -1 })).toEqual({
      ok: false,
      reason: "field `column` must be a positive integer",
    });
  });

  it("rejects empty text", () => {
    expect(parsePostBody({ ...validPostBody, text: "   " })).toEqual({
      ok: false,
      reason: "field `text` must be a non-empty string",
    });
  });

  it("rejects empty author", () => {
    expect(parsePostBody({ ...validPostBody, author: "" })).toEqual({
      ok: false,
      reason: "field `author` must be a non-empty string",
    });
  });

  it("rejects non-string existingAnchor", () => {
    expect(parsePostBody({ ...validPostBody, existingAnchor: 123 })).toEqual({
      ok: false,
      reason: "field `existingAnchor` must be a string",
    });
  });
});

describe("parsePatchBody", () => {
  it("parses text patch", () => {
    expect(parsePatchBody({ text: " updated " })).toEqual({
      ok: true,
      value: { kind: "text", text: "updated" },
    });
  });

  it("parses reply patch", () => {
    expect(
      parsePatchBody({
        reply: { author: "a@b.c", text: "looks good", v: 2 },
      })
    ).toEqual({
      ok: true,
      value: {
        kind: "reply",
        reply: { author: "a@b.c", text: "looks good", v: 2 },
      },
    });
  });

  it("parses editReply patch", () => {
    expect(
      parsePatchBody({ editReply: { index: 1, text: " revised " } })
    ).toEqual({
      ok: true,
      value: { kind: "editReply", replyIndex: 1, text: "revised" },
    });
  });

  it("parses deleteReply patch", () => {
    expect(parsePatchBody({ deleteReply: { index: 0 } })).toEqual({
      ok: true,
      value: { kind: "deleteReply", replyIndex: 0 },
    });
  });

  it("parses resolved patch", () => {
    expect(parsePatchBody({ resolved: true })).toEqual({
      ok: true,
      value: { kind: "resolved", resolved: true },
    });
    expect(parsePatchBody({ resolved: false })).toEqual({
      ok: true,
      value: { kind: "resolved", resolved: false },
    });
  });

  it("rejects bodies with no mutation field", () => {
    expect(parsePatchBody({})).toEqual({
      ok: false,
      reason:
        "body must include exactly one of `text`, `reply`, `editReply`, `deleteReply`, or `resolved`",
    });
  });

  it("rejects bodies with multiple mutation fields", () => {
    const result = parsePatchBody({
      text: "a",
      reply: { author: "x", text: "y" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid editReply index", () => {
    expect(parsePatchBody({ editReply: { index: -1, text: "nope" } })).toEqual({
      ok: false,
      reason: "field `editReply.index` must be a non-negative integer",
    });
  });

  it("rejects empty reply author", () => {
    expect(parsePatchBody({ reply: { author: "", text: "hi" } })).toEqual({
      ok: false,
      reason: "field `reply.author` must be a non-empty string",
    });
  });

  it("rejects non-boolean resolved", () => {
    expect(parsePatchBody({ resolved: "yes" })).toEqual({
      ok: false,
      reason: "field `resolved` must be a boolean",
    });
  });
});

describe("decodeScreenshotPng", () => {
  it("decodes a valid PNG data URL", () => {
    const bytes = decodeScreenshotPng(validPngDataUrl);
    expect(bytes).not.toBeNull();
    expect(bytes?.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it("rejects wrong prefix", () => {
    expect(decodeScreenshotPng("data:image/jpeg;base64,abc")).toBeNull();
  });

  it("rejects empty payload", () => {
    expect(decodeScreenshotPng("data:image/png;base64,")).toBeNull();
  });

  it("rejects invalid base64 that decodes empty", () => {
    expect(decodeScreenshotPng("data:image/png;base64,===")).toBeNull();
  });

  it("rejects truncated bytes shorter than signature", () => {
    const short = Buffer.from([0x89, 0x50]);
    expect(
      decodeScreenshotPng(`data:image/png;base64,${short.toString("base64")}`)
    ).toBeNull();
  });

  it("rejects wrong magic bytes", () => {
    const wrong = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    expect(
      decodeScreenshotPng(`data:image/png;base64,${wrong.toString("base64")}`)
    ).toBeNull();
  });

  it("rejects oversize PNG payloads", () => {
    const oversize = Buffer.alloc(5 * 1024 * 1024 + 1, 0x00);
    oversize.set(PNG_SIGNATURE, 0);
    expect(
      decodeScreenshotPng(
        `data:image/png;base64,${oversize.toString("base64")}`
      )
    ).toBeNull();
  });
});
