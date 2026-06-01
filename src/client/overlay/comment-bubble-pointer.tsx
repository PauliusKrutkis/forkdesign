import type { FloaterSide } from "./lib/placement.ts";

/** Triangle pointer from bubble back to the anchor dot. */
export function CommentBubblePointer({
  side,
  offset,
}: {
  side: FloaterSide;
  offset: number;
}) {
  if (side === "bottom") {
    return (
      <span
        aria-hidden
        className="absolute -top-[7px] block h-3 w-3 rotate-45 border-border border-t border-l bg-background"
        style={{ left: offset - 6 }}
      />
    );
  }
  if (side === "top") {
    return (
      <span
        aria-hidden
        className="absolute -bottom-[7px] block h-3 w-3 rotate-45 border-border border-r border-b bg-background"
        style={{ left: offset - 6 }}
      />
    );
  }
  if (side === "right") {
    return (
      <span
        aria-hidden
        className="absolute -left-[7px] block h-3 w-3 rotate-45 border-border border-b border-l bg-background"
        style={{ top: offset - 6 }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="absolute -right-[7px] block h-3 w-3 rotate-45 border-border border-t border-r bg-background"
      style={{ top: offset - 6 }}
    />
  );
}
