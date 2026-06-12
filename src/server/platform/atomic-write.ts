import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function atomicWriteBytes(
  absolutePath: string,
  bytes: Buffer
): Promise<void> {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath);
  const tmp = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );
  await writeFile(tmp, bytes);
  await rename(tmp, absolutePath);
}

export async function atomicWriteText(
  absolutePath: string,
  content: string
): Promise<void> {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath);
  const tmp = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );
  await writeFile(tmp, content, "utf8");
  await rename(tmp, absolutePath);
}
