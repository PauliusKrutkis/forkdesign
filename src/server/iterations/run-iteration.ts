import { copyFile, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { FoundComment } from "../comments/find-comment.ts";
import { updateCommentActive } from "../comments/writer.ts";
import { WriteError } from "../comments/writer-errors.ts";
import { getFixRuntimeConfig } from "../fix/config.ts";
import { runFix } from "../fix/index.ts";
import {
  buildFixModelChain,
  DEFAULT_FIX_MODEL_PRIORITY,
  type FixModel,
} from "../fix/models.ts";
import { atomicWriteText } from "../platform/atomic-write.ts";
import { errorMessage } from "../platform/http.ts";
import {
  findVersionPngPath,
  iterationPngUrl,
  nextIterationVersion,
  patchIterationsManifest,
  pngMtimeMs,
  resolveIterationDirRoots,
} from "./manifest.ts";

export interface NdjsonStream {
  abortController: AbortController;
  clientGone: () => boolean;
  endStream: (final: object) => void;
  writeEvent: (event: object) => void;
}

export function createNdjsonStream(
  req: IncomingMessage,
  res: ServerResponse
): NdjsonStream {
  const abortController = new AbortController();
  let clientGone = false;
  const onClose = () => {
    if (clientGone) {
      return;
    }
    clientGone = true;
    abortController.abort();
  };
  req.on("close", onClose);

  const writeEvent = (event: object): void => {
    if (clientGone || res.destroyed) {
      return;
    }
    try {
      res.write(`${JSON.stringify(event)}\n`);
    } catch {
      clientGone = true;
      abortController.abort();
    }
  };

  const endStream = (final: object): void => {
    writeEvent(final);
    try {
      res.end();
    } catch {
      /* socket already closed */
    }
  };

  return {
    writeEvent,
    endStream,
    abortController,
    clientGone: () => clientGone,
  };
}

export function openNdjsonResponse(res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.flushHeaders?.();
}

function activeUpdateErrorMessage(err: unknown): string {
  if (err instanceof WriteError) {
    return err.message;
  }
  return errorMessage(err);
}

async function persistNewIterationSnapshot(
  found: FoundComment,
  id: string,
  iterDir: string,
  nextV: number,
  afterSource: string,
  iterationRoots: string[],
  lastAgentSummary: string | undefined,
  stream: NdjsonStream
): Promise<{ ok: true; png: string } | { ok: false; error: string }> {
  const nextTsx = path.join(iterDir, `v${nextV}.tsx`);
  const nextPng = path.join(iterDir, `v${nextV}.png`);

  stream.writeEvent({
    type: "progress",
    stage: "snapshot",
    detail: `writing v${nextV}.tsx`,
  });

  try {
    await atomicWriteText(nextTsx, afterSource);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }

  try {
    const v0Png = findVersionPngPath(iterationRoots, 0);
    if (v0Png) {
      await copyFile(v0Png, nextPng);
    }
  } catch (err) {
    console.warn(
      `[vite-plugin-comments] failed to copy v0.png → v${nextV}.png: ${errorMessage(err)}`
    );
  }

  stream.writeEvent({
    type: "progress",
    stage: "snapshot",
    detail: `setting active=${nextV}`,
  });

  try {
    await updateCommentActive({
      absolutePath: found.absolutePath,
      commentId: id,
      active: nextV,
    });
  } catch (err) {
    return { ok: false, error: activeUpdateErrorMessage(err) };
  }

  try {
    const summary = lastAgentSummary?.trim() || `Fix v${nextV}`;
    await patchIterationsManifest(iterDir, nextV, {
      summary,
      createdAt: new Date().toISOString(),
    });
  } catch (manifestErr) {
    console.warn(
      `[vite-plugin-comments] failed to write iteration manifest: ${errorMessage(manifestErr)}`
    );
  }

  return {
    ok: true,
    png: iterationPngUrl(id, nextV, pngMtimeMs(iterationRoots, nextV)),
  };
}

export interface RunNewIterationInput {
  found: FoundComment;
  id: string;
  model: FixModel;
  projectRoot: string;
  stream: NdjsonStream;
}

export async function runNewIteration(
  input: RunNewIterationInput
): Promise<void> {
  const { projectRoot, found, id, model, stream } = input;

  stream.writeEvent({
    type: "progress",
    stage: "agent",
    detail: "dispatching",
  });

  const fixStartedAt = Date.now();
  const priority =
    getFixRuntimeConfig().fixModelPriority ?? DEFAULT_FIX_MODEL_PRIORITY;
  const modelChain = buildFixModelChain(model, priority);

  let beforeSource: string;
  try {
    beforeSource = await readFile(found.absolutePath, "utf8");
  } catch (err) {
    stream.endStream({
      type: "done",
      ok: false,
      error: errorMessage(err),
    });
    return;
  }

  console.info(
    `[vite-plugin-comments] dispatching fix model=${model} chain=[${modelChain.join(", ")}] comment=${id} file=${found.relativePath}`
  );

  let lastAgentSummary: string | undefined;
  const agentResult = await runFix({
    projectRoot,
    file: found.relativePath,
    anchor: found.comment.anchor,
    text: found.comment.text,
    screenshot: found.comment.screenshot,
    view: found.comment.view,
    activeVersion: found.comment.active ?? 0,
    replies: found.comment.replies,
    model,
    signal: stream.abortController.signal,
    onEvent: (e) => {
      if (e.kind === "tool_use_summary" && e.detail) {
        lastAgentSummary = e.detail;
      } else if (e.detail) {
        lastAgentSummary = lastAgentSummary ?? e.detail;
      }
      stream.writeEvent({
        type: "progress",
        stage: "agent",
        ...(e.tool ? { tool: e.tool } : {}),
        ...(e.detail ? { detail: e.detail } : {}),
      });
    },
  });

  if (stream.clientGone()) {
    return;
  }

  if (!agentResult.ok) {
    stream.endStream({ type: "done", ok: false, error: agentResult.error });
    return;
  }

  const durationMs = Date.now() - fixStartedAt;
  const modelUsed = agentResult.modelUsed;

  stream.writeEvent({
    type: "progress",
    stage: "snapshot",
    detail: "reading post-edit source",
  });

  let afterSource: string;
  try {
    afterSource = await readFile(found.absolutePath, "utf8");
  } catch (err) {
    stream.endStream({
      type: "done",
      ok: false,
      error: errorMessage(err),
    });
    return;
  }

  if (afterSource === beforeSource) {
    stream.endStream({
      type: "done",
      ok: true,
      id,
      changed: false,
      modelUsed,
      durationMs,
      turnsUsed: agentResult.turnsUsed,
      toolCalls: agentResult.toolCalls,
    });
    return;
  }

  const iterDir = path.join(projectRoot, "designs", "iterations", id);
  const versionResult = await nextIterationVersion(iterDir);
  if (!versionResult.ok) {
    stream.endStream({
      type: "done",
      ok: false,
      error: versionResult.error,
    });
    return;
  }
  const nextV = versionResult.nextV;
  const iterationRoots = resolveIterationDirRoots(projectRoot, id);

  const persisted = await persistNewIterationSnapshot(
    found,
    id,
    iterDir,
    nextV,
    afterSource,
    iterationRoots,
    lastAgentSummary,
    stream
  );
  if (!persisted.ok) {
    stream.endStream({ type: "done", ok: false, error: persisted.error });
    return;
  }

  if (stream.clientGone()) {
    return;
  }

  stream.endStream({
    type: "done",
    ok: true,
    id,
    changed: true,
    v: nextV,
    tsx: `/designs/iterations/${id}/v${nextV}.tsx`,
    png: persisted.png,
    modelUsed,
    durationMs,
    turnsUsed: agentResult.turnsUsed,
    toolCalls: agentResult.toolCalls,
  });
}
