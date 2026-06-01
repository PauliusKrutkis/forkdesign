import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface MockResponse {
  getBody: () => string;
  getJson: () => unknown;
  getStatus: () => number;
  res: ServerResponse;
}

export function createJsonRequest(
  body: unknown,
  options: { method?: string; url?: string } = {}
): IncomingMessage {
  const payload =
    body === undefined || body === null ? "" : JSON.stringify(body);
  const req = new EventEmitter() as IncomingMessage;
  req.method = options.method ?? "POST";
  req.url = options.url ?? "/";
  req.headers = { "content-type": "application/json" };
  queueMicrotask(() => {
    if (payload.length > 0) {
      req.emit("data", Buffer.from(payload, "utf8"));
    }
    req.emit("end");
  });
  return req;
}

export function createMockResponse(): MockResponse {
  let statusCode = 200;
  const headers: Record<string, string | string[]> = {};
  let body = "";

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()] ?? undefined;
    },
    end(chunk?: string) {
      body = chunk ?? "";
    },
  } as unknown as ServerResponse;

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body,
    getJson: () => JSON.parse(body),
  };
}
