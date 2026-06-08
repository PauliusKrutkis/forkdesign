import type {
  ComposerSubmission,
  ComposerSubmitResult,
} from "../comment-composer.tsx";
import { postJson, readApiError } from "./api.ts";
import { currentAppRoute, getCommentAuthor } from "./comment-author.ts";
import { toErrorMessage } from "./errors.ts";
import { findSourceLoc } from "./source-loc.ts";

export async function submitComment(
  entry: ComposerSubmission
): Promise<
  | { ok: true; id?: string }
  | { ok: false; error: string; result: ComposerSubmitResult }
> {
  const src = findSourceLoc(entry.target);
  if (!src) {
    return {
      ok: false,
      error: "couldn't locate this element in source. Try a different element.",
      result: {
        ok: false,
        error:
          "couldn't locate this element in source. Try a different element.",
      },
    };
  }

  const existingAnchor =
    entry.target.getAttribute("data-comment-anchor") ?? undefined;
  const author = getCommentAuthor();
  const route = currentAppRoute();

  try {
    const res = await postJson("/api/comments", {
      file: src.file,
      line: src.line,
      column: src.column,
      text: entry.text,
      author,
      ...(existingAnchor ? { existingAnchor } : {}),
      ...(entry.screenshotPng ? { screenshotPng: entry.screenshotPng } : {}),
      ...(route ? { route } : {}),
    });
    if (!res.ok) {
      const error = await readApiError(res);
      return { ok: false, error, result: { ok: false, error } };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: body.id };
  } catch (err) {
    const error = `network error: ${toErrorMessage(err)}`;
    return { ok: false, error, result: { ok: false, error } };
  }
}
