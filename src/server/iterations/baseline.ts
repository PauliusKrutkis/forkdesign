import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteBytes, atomicWriteText } from "../platform/atomic-write.ts";
import { patchIterationsManifest } from "./manifest.ts";

/**
 * Seeds v0 baseline artifacts under `public/designs/iterations/<id>/` after a
 * comment POST. Called only after the writer succeeds so v0.tsx includes the
 * freshly-written marker (see bug #24).
 */
export async function seedBaselineIteration(
  projectRoot: string,
  commentId: string,
  screenshotBytes: Buffer | null,
  baselineSource: string | null
): Promise<string | null> {
  if (!screenshotBytes && baselineSource === null) {
    return null;
  }
  try {
    const iterDir = path.join(
      projectRoot,
      "public",
      "designs",
      "iterations",
      commentId
    );
    await mkdir(iterDir, { recursive: true });
    let savedScreenshotUrl: string | null = null;
    if (screenshotBytes) {
      await atomicWriteBytes(path.join(iterDir, "v0.png"), screenshotBytes);
      savedScreenshotUrl = `/designs/iterations/${commentId}/v0.png`;
    }
    if (baselineSource !== null) {
      await atomicWriteText(path.join(iterDir, "v0.tsx"), baselineSource);
    }
    try {
      await patchIterationsManifest(iterDir, 0, {
        summary: "Baseline",
        createdAt: new Date().toISOString(),
        screenshotCaptured: Boolean(screenshotBytes),
      });
    } catch (manifestErr) {
      console.warn(
        `[vite-plugin-comments] failed to write iteration manifest: ${manifestErr instanceof Error ? manifestErr.message : String(manifestErr)}`
      );
    }
    return savedScreenshotUrl;
  } catch (err) {
    console.warn(
      `[vite-plugin-comments] failed to write iteration artifacts: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
