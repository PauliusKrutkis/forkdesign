const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
/** Hard cap on the decoded PNG. 5 MB is plenty for an element-bbox capture. */
const MAX_PNG_BYTES = 5 * 1024 * 1024;
/** First 8 bytes of any PNG. Used as a structural sanity check after decode. */
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Parse a `data:image/png;base64,...` URL, decode it, and apply size + signature
 * guards. Returns null on any mismatch — caller logs a warning and proceeds
 * without a screenshot.
 */
export function decodeScreenshotPng(dataUrl: string): Buffer | null {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return null;
  }
  const payload = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  if (payload.length === 0) {
    return null;
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, "base64");
  } catch {
    return null;
  }
  if (bytes.length === 0) {
    return null;
  }
  if (bytes.length > MAX_PNG_BYTES) {
    return null;
  }
  if (bytes.length < PNG_SIGNATURE.length) {
    return null;
  }
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return null;
  }
  return bytes;
}

export interface PostBody {
  author: string;
  column: number;
  existingAnchor?: string;
  file: string;
  line: number;
  /** App route (pathname + search + hash) where the comment was created. */
  route?: string;
  /**
   * Optional `data:image/png;base64,...` URL captured client-side by the
   * composer. The server decodes it, saves a `v0.png` baseline under
   * `public/designs/iterations/<comment-id>/`, and stamps the resulting URL
   * onto the `@comment` directive's `screenshot` attribute.
   */
  screenshotPng?: string;
  text: string;
}

export type ParseBodyResult =
  | { ok: true; value: PostBody }
  | { ok: false; reason: string };

export type PatchBody =
  | { kind: "text"; text: string }
  | { kind: "reply"; reply: { author: string; text: string; v?: number } }
  | { kind: "editReply"; replyIndex: number; text: string }
  | { kind: "deleteReply"; replyIndex: number };

export type ParsePatchBodyResult =
  | { ok: true; value: PatchBody }
  | { ok: false; reason: string };

export function parsePatchBody(value: unknown): ParsePatchBodyResult {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  const hasText = "text" in obj;
  const hasReply = "reply" in obj;
  const hasEditReply = "editReply" in obj;
  const hasDeleteReply = "deleteReply" in obj;
  const fieldCount = [hasText, hasReply, hasEditReply, hasDeleteReply].filter(
    Boolean
  ).length;

  if (fieldCount !== 1) {
    return {
      ok: false,
      reason:
        "body must include exactly one of `text`, `reply`, `editReply`, or `deleteReply`",
    };
  }

  if (hasText) {
    const text = obj.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return { ok: false, reason: "field `text` must be a non-empty string" };
    }
    return { ok: true, value: { kind: "text", text: text.trim() } };
  }

  if (hasEditReply) {
    const editReply = obj.editReply;
    if (!editReply || typeof editReply !== "object") {
      return { ok: false, reason: "field `editReply` must be an object" };
    }
    const editReplyObj = editReply as Record<string, unknown>;
    const index = editReplyObj.index;
    const text = editReplyObj.text;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return {
        ok: false,
        reason: "field `editReply.index` must be a non-negative integer",
      };
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      return {
        ok: false,
        reason: "field `editReply.text` must be a non-empty string",
      };
    }
    return {
      ok: true,
      value: { kind: "editReply", replyIndex: index, text: text.trim() },
    };
  }

  if (hasDeleteReply) {
    const deleteReply = obj.deleteReply;
    if (!deleteReply || typeof deleteReply !== "object") {
      return { ok: false, reason: "field `deleteReply` must be an object" };
    }
    const index = (deleteReply as Record<string, unknown>).index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return {
        ok: false,
        reason: "field `deleteReply.index` must be a non-negative integer",
      };
    }
    return { ok: true, value: { kind: "deleteReply", replyIndex: index } };
  }

  const reply = obj.reply;
  if (!reply || typeof reply !== "object") {
    return { ok: false, reason: "field `reply` must be an object" };
  }
  const replyObj = reply as Record<string, unknown>;
  const author = replyObj.author;
  const replyText = replyObj.text;
  if (typeof author !== "string" || author.trim().length === 0) {
    return {
      ok: false,
      reason: "field `reply.author` must be a non-empty string",
    };
  }
  if (typeof replyText !== "string" || replyText.trim().length === 0) {
    return {
      ok: false,
      reason: "field `reply.text` must be a non-empty string",
    };
  }
  const replyV = replyObj.v;
  if (
    replyV !== undefined &&
    (typeof replyV !== "number" || !Number.isInteger(replyV) || replyV < 0)
  ) {
    return {
      ok: false,
      reason: "field `reply.v` must be a non-negative integer",
    };
  }
  return {
    ok: true,
    value: {
      kind: "reply",
      reply: {
        author: author.trim(),
        text: replyText.trim(),
        ...(replyV === undefined ? {} : { v: replyV }),
      },
    },
  };
}

export function parsePostBody(value: unknown): ParseBodyResult {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  const file = obj.file;
  const line = obj.line;
  const column = obj.column;
  const text = obj.text;
  const author = obj.author;
  const existingAnchor = obj.existingAnchor;
  const screenshotPng = obj.screenshotPng;
  const route = obj.route;

  if (typeof file !== "string" || file.length === 0) {
    return { ok: false, reason: "field `file` must be a non-empty string" };
  }
  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    return { ok: false, reason: "field `line` must be a positive integer" };
  }
  if (typeof column !== "number" || !Number.isInteger(column) || column < 1) {
    return { ok: false, reason: "field `column` must be a positive integer" };
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, reason: "field `text` must be a non-empty string" };
  }
  if (typeof author !== "string" || author.trim().length === 0) {
    return { ok: false, reason: "field `author` must be a non-empty string" };
  }
  if (existingAnchor !== undefined && typeof existingAnchor !== "string") {
    return { ok: false, reason: "field `existingAnchor` must be a string" };
  }
  if (screenshotPng !== undefined && typeof screenshotPng !== "string") {
    return { ok: false, reason: "field `screenshotPng` must be a string" };
  }
  if (route !== undefined && typeof route !== "string") {
    return { ok: false, reason: "field `route` must be a string" };
  }
  return {
    ok: true,
    value: {
      file,
      line,
      column,
      text,
      author: author.trim(),
      ...(typeof existingAnchor === "string" ? { existingAnchor } : {}),
      ...(typeof screenshotPng === "string" ? { screenshotPng } : {}),
      ...(typeof route === "string" ? { route } : {}),
    },
  };
}
