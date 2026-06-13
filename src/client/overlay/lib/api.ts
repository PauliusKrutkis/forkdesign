export async function readApiError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `request failed (${res.status})`;
}

export async function assertOk(res: Response): Promise<void> {
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
}

export function postJson(
  path: string,
  body: unknown,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(path, {
    ...init,
    method: init.method ?? "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function patchComment(
  id: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await postJson(`/api/comments/${encodeURIComponent(id)}`, body, {
    method: "PATCH",
  });
  await assertOk(res);
}

export async function deleteComment(
  id: string,
  options?: { revertBaseline?: boolean }
): Promise<void> {
  const query = options?.revertBaseline === true ? "?revert=baseline" : "";
  const res = await fetch(`/api/comments/${encodeURIComponent(id)}${query}`, {
    method: "DELETE",
  });
  await assertOk(res);
}
