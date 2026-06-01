import { Badge } from "../ui/badge.tsx";
import { cn } from "../ui/cn.ts";
import { formatVersionDisplay } from "./CommentVersionHistory";
import { formatDate } from "./lib/bubbleFormatters.ts";

/** One-line `author · date` metadata row. */
export function CommentBubbleAttribution({
  author,
  date,
  className,
}: {
  author: string;
  date: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs",
        className
      )}
    >
      <span className="truncate">{author}</span>
      <span aria-hidden className="text-muted-foreground/40">
        ·
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums">
        {formatDate(date)}
      </span>
    </div>
  );
}

export function ReplyVersionBadge({ v }: { v?: number }) {
  if (v === undefined) {
    return (
      <Badge
        className="h-5 shrink-0 px-1.5 font-normal text-[10px] text-muted-foreground"
        variant="outline"
      >
        Unversioned
      </Badge>
    );
  }
  return (
    <Badge
      className="h-5 shrink-0 px-1.5 font-normal text-[10px]"
      variant="outline"
    >
      Re: {formatVersionDisplay(v)}
    </Badge>
  );
}
