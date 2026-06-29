const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const MAX_PNG_BYTES = 5 * 1024 * 1024;
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
