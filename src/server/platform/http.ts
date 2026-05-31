import type { IncomingMessage, ServerResponse } from "node:http";

export type ReadBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

export async function readJsonBody(
  req: IncomingMessage
): Promise<ReadBodyResult> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toString().toLowerCase().includes("application/json")) {
    return { ok: false, reason: "expected content-type: application/json" };
  }
  // 8 MiB ceiling — the body now carries an optional base64-encoded PNG of
  // the targeted element, which can run a few MB for big captures. The PNG
  // itself is bounded to ~5 MB after decode (see screenshot handling below);
  // base64 inflates by ~4/3, plus there's the small JSON envelope, so we
  // give a comfortable upper bound here without leaving the door wide open.
  const MAX_BYTES = 8 * 1024 * 1024;
  return new Promise<ReadBodyResult>((resolve) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        req.removeAllListeners("data");
        req.removeAllListeners("end");
        resolve({ ok: false, reason: "request body too large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const value = raw.length === 0 ? {} : JSON.parse(raw);
        resolve({ ok: true, value });
      } catch (err) {
        resolve({
          ok: false,
          reason: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
    req.on("error", (err) => {
      resolve({ ok: false, reason: `request error: ${err.message}` });
    });
  });
}

export function sendError(
  res: ServerResponse,
  status: number,
  message: string
): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify({ error: message }));
}
