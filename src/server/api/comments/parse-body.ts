import {
  type ParseResult,
  requireInt,
  requireNonEmptyString,
  requireObject,
} from "../../platform/validation.ts";

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

export type ParseBodyResult = ParseResult<PostBody>;
export type ParsePatchBodyResult = ParseResult<PatchBody>;

export type PatchBody =
  | { kind: "text"; text: string }
  | { kind: "reply"; reply: { author: string; text: string; v?: number } }
  | { kind: "editReply"; replyIndex: number; text: string }
  | { kind: "deleteReply"; replyIndex: number }
  | { kind: "resolved"; resolved: boolean };

function parsePatchTextField(
  obj: Record<string, unknown>
): ParsePatchBodyResult {
  const text = obj.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, reason: "field `text` must be a non-empty string" };
  }
  return { ok: true, value: { kind: "text", text: text.trim() } };
}

function parsePatchEditReplyField(
  obj: Record<string, unknown>
): ParsePatchBodyResult {
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

function parsePatchDeleteReplyField(
  obj: Record<string, unknown>
): ParsePatchBodyResult {
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

function parsePatchResolvedField(
  obj: Record<string, unknown>
): ParsePatchBodyResult {
  const resolved = obj.resolved;
  if (typeof resolved !== "boolean") {
    return { ok: false, reason: "field `resolved` must be a boolean" };
  }
  return { ok: true, value: { kind: "resolved", resolved } };
}

function parsePatchReplyField(
  obj: Record<string, unknown>
): ParsePatchBodyResult {
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

export function parsePatchBody(value: unknown): ParsePatchBodyResult {
  const objResult = requireObject(value);
  if (!objResult.ok) {
    return objResult;
  }
  const obj = objResult.value;
  const hasText = "text" in obj;
  const hasReply = "reply" in obj;
  const hasEditReply = "editReply" in obj;
  const hasDeleteReply = "deleteReply" in obj;
  const hasResolved = "resolved" in obj;
  const fieldCount = [
    hasText,
    hasReply,
    hasEditReply,
    hasDeleteReply,
    hasResolved,
  ].filter(Boolean).length;

  if (fieldCount !== 1) {
    return {
      ok: false,
      reason:
        "body must include exactly one of `text`, `reply`, `editReply`, `deleteReply`, or `resolved`",
    };
  }

  if (hasText) {
    return parsePatchTextField(obj);
  }
  if (hasEditReply) {
    return parsePatchEditReplyField(obj);
  }
  if (hasDeleteReply) {
    return parsePatchDeleteReplyField(obj);
  }
  if (hasResolved) {
    return parsePatchResolvedField(obj);
  }
  return parsePatchReplyField(obj);
}

function parseOptionalPostFields(
  obj: Record<string, unknown>
): { ok: true; value: Partial<PostBody> } | { ok: false; reason: string } {
  const existingAnchor = obj.existingAnchor;
  const screenshotPng = obj.screenshotPng;
  const route = obj.route;

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
      ...(typeof existingAnchor === "string" ? { existingAnchor } : {}),
      ...(typeof screenshotPng === "string" ? { screenshotPng } : {}),
      ...(typeof route === "string" ? { route } : {}),
    },
  };
}

export function parsePostBody(value: unknown): ParseBodyResult {
  const objResult = requireObject(value);
  if (!objResult.ok) {
    return objResult;
  }
  const obj = objResult.value;
  const file = requireNonEmptyString(obj, "file");
  if (!file.ok) {
    return file;
  }
  const line = requireInt(obj, "line", { min: 1 });
  if (!line.ok) {
    return { ok: false, reason: "field `line` must be a positive integer" };
  }
  const column = requireInt(obj, "column", { min: 1 });
  if (!column.ok) {
    return { ok: false, reason: "field `column` must be a positive integer" };
  }
  const text = requireNonEmptyString(obj, "text");
  if (!text.ok) {
    return { ok: false, reason: "field `text` must be a non-empty string" };
  }
  if (text.value.trim().length === 0) {
    return { ok: false, reason: "field `text` must be a non-empty string" };
  }
  const author = requireNonEmptyString(obj, "author");
  if (!author.ok) {
    return { ok: false, reason: "field `author` must be a non-empty string" };
  }

  const optional = parseOptionalPostFields(obj);
  if (!optional.ok) {
    return optional;
  }

  return {
    ok: true,
    value: {
      file: file.value,
      line: line.value,
      column: column.value,
      text: text.value,
      author: author.value.trim(),
      ...optional.value,
    },
  };
}
