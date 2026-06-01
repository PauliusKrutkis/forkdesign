export async function readApiError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `request failed (${res.status})`;
}

export async function assertOk(res: Response): Promise<void> {
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
}

export async function patchComment(
  id: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`/api/comments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
