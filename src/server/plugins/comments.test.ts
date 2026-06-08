import { describe, expect, it } from "vitest";
import { isLoopbackRemoteAddress } from "./comments.ts";

describe("isLoopbackRemoteAddress", () => {
  it("accepts IPv4 and IPv6 loopback addresses", () => {
    expect(isLoopbackRemoteAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("127.10.20.30")).toBe(true);
    expect(isLoopbackRemoteAddress("::1")).toBe(true);
    expect(isLoopbackRemoteAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects remote or missing addresses", () => {
    expect(isLoopbackRemoteAddress("192.168.1.20")).toBe(false);
    expect(isLoopbackRemoteAddress("10.0.0.5")).toBe(false);
    expect(isLoopbackRemoteAddress(undefined)).toBe(false);
  });
});
