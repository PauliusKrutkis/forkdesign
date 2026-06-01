import type { IncomingMessage, ServerResponse } from "node:http";
import { errorMessage as formatErrorMessage } from "./errors.ts";

export type ReadBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

export type ApiHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => void | Promise<void>;

export function errorMessage(err: unknown): string {
  return formatErrorMessage(err);
}

export function sendJson(
  res: ServerResponse,
  body: unknown,
  status = 200
): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export function wrapApiHandler(handler: ApiHandler): ApiHandler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      sendError(res, 500, errorMessage(err));
    }
  };
}

export async function readAndParse<T>(
  req: IncomingMessage,
  parse: (
    value: unknown
  ) => { ok: true; value: T } | { ok: false; reason: string }
): Promise<
  { ok: true; value: T } | { ok: false; status: number; reason: string }
> {
  const body = await readJsonBody(req);
  if (!body.ok) {
    return { ok: false, status: 400, reason: body.reason };
  }
  const parsed = parse(body.value);
  if (!parsed.ok) {
    return { ok: false, status: 400, reason: parsed.reason };
  }
  return parsed;
}

export function readJsonBody(req: IncomingMessage): Promise<ReadBodyResult> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toString().toLowerCase().includes("application/json")) {
    return Promise.resolve({
      ok: false,
      reason: "expected content-type: application/json",
    });
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
          reason: `invalid JSON: ${errorMessage(err)}`,
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
