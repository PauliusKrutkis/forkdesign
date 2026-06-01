import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { readJsonBody, sendError } from "./http.ts";
import { createJsonRequest, createMockResponse } from "./http-test-helpers.ts";

const INVALID_JSON_PREFIX_RE = /^invalid JSON:/;

describe("readJsonBody", () => {
  it("parses valid JSON with application/json content-type", async () => {
    const req = createJsonRequest({ file: "src/a.tsx", line: 1 });
    const result = await readJsonBody(req);
    expect(result).toEqual({ ok: true, value: { file: "src/a.tsx", line: 1 } });
  });

  it("returns empty object for empty body", async () => {
    const req = createJsonRequest(undefined);
    const result = await readJsonBody(req);
    expect(result).toEqual({ ok: true, value: {} });
  });

  it("rejects missing content-type", async () => {
    const req = createJsonRequest({ a: 1 });
    req.headers = {};
    const result = await readJsonBody(req);
    expect(result).toEqual({
      ok: false,
      reason: "expected content-type: application/json",
    });
  });

  it("rejects invalid JSON", async () => {
    const req = new EventEmitter() as IncomingMessage;
    req.headers = { "content-type": "application/json" };
    queueMicrotask(() => {
      req.emit("data", Buffer.from("{not json", "utf8"));
      req.emit("end");
    });
    const result = await readJsonBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(INVALID_JSON_PREFIX_RE);
    }
  });
});

describe("sendError", () => {
  it("sets status, headers, and JSON error body", () => {
    const mock = createMockResponse();
    sendError(mock.res, 400, "bad request");
    expect(mock.getStatus()).toBe(400);
    expect(mock.res.getHeader("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    expect(mock.getJson()).toEqual({ error: "bad request" });
  });
});
