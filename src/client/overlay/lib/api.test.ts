import { describe, expect, it } from "vitest";
import { assertOk, readApiError } from "./api.ts";

describe("readApiError", () => {
  it("reads error field from JSON body", async () => {
    const res = new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
    });
    expect(await readApiError(res)).toBe("not found");
  });

  it("falls back to status when body has no error", async () => {
    const res = new Response("{}", { status: 500 });
    expect(await readApiError(res)).toBe("request failed (500)");
  });
});

describe("assertOk", () => {
  it("does not throw for ok responses", async () => {
    const res = new Response(null, { status: 200 });
    await expect(assertOk(res)).resolves.toBeUndefined();
  });

  it("throws with parsed error for failed responses", async () => {
    const res = new Response(JSON.stringify({ error: "bad request" }), {
      status: 400,
    });
    await expect(assertOk(res)).rejects.toThrow("bad request");
  });
});
