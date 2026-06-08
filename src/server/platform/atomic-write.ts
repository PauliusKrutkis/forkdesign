import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Per-write unique temp path. `Date.now()` alone collides when two writes hit
// the same target within a millisecond from one process: they share a temp
// path, so the first rename consumes it and the rest reject with ENOENT. The
// random suffix gives every write its own temp file.
function tempPathFor(absolutePath: string): string {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath);
  return path.join(dir, `.${base}.${process.pid}.${randomUUID()}.tmp`);
}

export async function atomicWriteBytes(
  absolutePath: string,
  bytes: Buffer
): Promise<void> {
  const tmp = tempPathFor(absolutePath);
  await writeFile(tmp, bytes);
  await rename(tmp, absolutePath);
}

export async function atomicWriteText(
  absolutePath: string,
  content: string
): Promise<void> {
  const tmp = tempPathFor(absolutePath);
  await writeFile(tmp, content, "utf8");
  await rename(tmp, absolutePath);
}
