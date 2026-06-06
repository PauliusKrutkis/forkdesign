/**
 * Classify agent errors that warrant trying the next model in the priority chain.
 */

export function shouldFallbackAgent(error: string): boolean {
  if (error === "aborted") {
    return false;
  }

  const lower = error.toLowerCase();

  if (
    lower.includes("not authenticated") ||
    lower.includes("invalid api key") ||
    lower.includes("authentication required") ||
    lower.includes("authentication failed")
  ) {
    return true;
  }

  if (
    lower.includes("enoent") ||
    lower.includes("command not found") ||
    lower.includes("not found — install") ||
    lower.includes("(`agent`) not found")
  ) {
    return true;
  }

  if (
    lower.includes("bad model") ||
    lower.includes("unknown model") ||
    lower.includes("model not found") ||
    lower.includes("invalid model") ||
    lower.includes("unsupported model")
  ) {
    return true;
  }

  if (lower.includes("cursor cli exited with code")) {
    return true;
  }

  if (
    lower.includes("cursor cli failed") &&
    lower.includes("not authenticated")
  ) {
    return true;
  }

  return false;
}
