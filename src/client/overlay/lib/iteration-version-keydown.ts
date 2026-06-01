import { isInTextInput } from "./hotkeys.ts";
import { ignorePromiseRejection } from "./ignore-promise-rejection.ts";

interface IterationVersionKeydownContext {
  activate: (v: number) => Promise<void>;
  active: number;
  deleting: boolean;
  switching: boolean;
  versionIndices: number[];
}

function handleVersionArrowKey(
  e: KeyboardEvent,
  ctx: IterationVersionKeydownContext,
  direction: "left" | "right"
): void {
  if (ctx.switching || ctx.deleting) {
    return;
  }
  const pos = ctx.versionIndices.indexOf(ctx.active);
  if (pos < 0) {
    return;
  }
  if (direction === "left" && pos > 0) {
    e.preventDefault();
    ctx
      .activate(ctx.versionIndices[pos - 1] ?? ctx.active)
      .catch(ignorePromiseRejection);
    return;
  }
  if (direction === "right" && pos < ctx.versionIndices.length - 1) {
    e.preventDefault();
    ctx
      .activate(ctx.versionIndices[pos + 1] ?? ctx.active)
      .catch(ignorePromiseRejection);
  }
}

export function handleIterationVersionKeydown(
  e: KeyboardEvent,
  ctx: IterationVersionKeydownContext
): void {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    return;
  }
  if (isInTextInput(document.activeElement)) {
    return;
  }
  if (e.key === "ArrowLeft") {
    handleVersionArrowKey(e, ctx, "left");
  } else if (e.key === "ArrowRight") {
    handleVersionArrowKey(e, ctx, "right");
  }
}
