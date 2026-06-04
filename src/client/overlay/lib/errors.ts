export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function toErrorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  return String(err);
}
