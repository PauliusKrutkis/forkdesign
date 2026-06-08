import path from "node:path";

export const SRC_REL = "src";

const SAFE_PATH_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const ITERATION_SCREENSHOT_RE =
  /^\/designs\/iterations\/([A-Za-z0-9_-]+)\/v\d+\.png(?:\?t=\d+)?$/;

export type SafePathResult =
  | { ok: true; absolutePath: string; relativePath: string }
  | { ok: false; reason: string };

export function isSafePathSegment(value: string): boolean {
  return SAFE_PATH_SEGMENT_RE.test(value);
}

export function isSafeIterationScreenshotPath(value: string): boolean {
  const match = value.match(ITERATION_SCREENSHOT_RE);
  return match?.[1] !== undefined && isSafePathSegment(match[1]);
}

export function resolveSafeProjectRelativePath(
  projectRoot: string,
  relPosix: string
): SafePathResult {
  if (path.isAbsolute(relPosix)) {
    return { ok: false, reason: "path must be relative" };
  }
  const normalized = relPosix.split("\\").join(path.posix.sep);
  if (!(normalized && normalized === path.posix.normalize(normalized))) {
    return { ok: false, reason: "path traversal rejected" };
  }
  const candidateAbs = path.resolve(projectRoot, normalized);
  const rel = path.relative(projectRoot, candidateAbs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: "path traversal rejected" };
  }
  return {
    ok: true,
    absolutePath: candidateAbs,
    relativePath: normalized,
  };
}

/**
 * Accept any `.tsx` under `src/` except configured exclude prefixes.
 * Verify after resolution that the absolute path stays inside `<root>/src/`.
 * Defeats `../` traversal and absolute-path inputs.
 */
export function resolveSafePagePath(
  projectRoot: string,
  file: string,
  excludeSrcPrefixes: string[]
): SafePathResult {
  if (path.isAbsolute(file)) {
    return { ok: false, reason: "file must be a relative path" };
  }
  // Normalize separators for cross-platform sanity and check prefix on the
  // posix-style relative path before resolution.
  const normalized = file.split(path.sep).join(path.posix.sep);
  if (!normalized.startsWith(`${SRC_REL}/`)) {
    return { ok: false, reason: `file must be under ${SRC_REL}/` };
  }
  if (!normalized.endsWith(".tsx")) {
    return { ok: false, reason: "file must end in .tsx" };
  }
  for (const excluded of excludeSrcPrefixes) {
    if (normalized.startsWith(excluded)) {
      return {
        ok: false,
        reason: `file is under ${excluded} (excluded via excludeSrcPrefixes)`,
      };
    }
  }

  const srcRootAbs = path.resolve(projectRoot, SRC_REL);
  const candidateAbs = path.resolve(projectRoot, normalized);
  // Containment check — path.resolve collapses `..`, so verify the result is
  // actually inside the src root.
  const rel = path.relative(srcRootAbs, candidateAbs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: "path traversal rejected" };
  }

  return {
    ok: true,
    absolutePath: candidateAbs,
    relativePath: normalized,
  };
}
