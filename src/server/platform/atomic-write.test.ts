import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { atomicWriteBytes, atomicWriteText } from "./atomic-write.ts";

const dir = mkdtempSync(path.join(tmpdir(), "atomic-write-test-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomicWriteText", () => {
  it("writes the final file without leaving tmp artifacts", async () => {
    const target = path.join(dir, "output.txt");
    await atomicWriteText(target, "hello world");

    expect(readFileSync(target, "utf8")).toBe("hello world");
    const leftovers = readdirSync(dir).filter((name) => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("overwrites an existing file", async () => {
    const target = path.join(dir, "overwrite.txt");
    writeFileSync(target, "old", "utf8");
    await atomicWriteText(target, "new");

    expect(readFileSync(target, "utf8")).toBe("new");
  });
});

describe("atomicWriteBytes", () => {
  it("writes binary content atomically", async () => {
    const target = path.join(dir, "image.bin");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await atomicWriteBytes(target, bytes);

    expect(readFileSync(target)).toEqual(bytes);
  });
});
