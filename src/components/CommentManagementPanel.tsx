import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import type { CommentData } from "./types";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";

type CommentWithFile = CommentData & { file?: string };

export type CommentManagementPanelProps = {
  comments: CommentData[];
  inDomAnchors: Set<string>;
  onJump: (target: { anchor: string; instance: number }) => void;
  onGoToPage: (comment: CommentWithFile) => void;
  fileToRoute?: (
    file: string,
    ctx: { view?: string | null },
  ) => string | null;
  onDelete: (id: string) => Promise<void>;
};

export function CommentManagementPanel({
  comments,
  inDomAnchors,
  onJump,
  onGoToPage,
  fileToRoute,
  onDelete,
}: CommentManagementPanelProps) {
  const withFile = comments as CommentWithFile[];

  const { onPage, offPage } = useMemo(() => {
    const on: CommentWithFile[] = [];
    const off: CommentWithFile[] = [];
    for (const c of withFile) {
      if (inDomAnchors.has(c.anchor)) on.push(c);
      else off.push(c);
    }
    const byDate = (a: CommentWithFile, b: CommentWithFile) =>
      Date.parse(b.date) - Date.parse(a.date);
    on.sort(byDate);
    off.sort(byDate);
    return { onPage: on, offPage: off };
  }, [withFile, inDomAnchors]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommentWithFile[]>();
    for (const c of onPage) {
      const key = c.file ?? "(unknown)";
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [onPage]);

  const total = withFile.length;

  if (total === 0) {
    return (
      <div className="grid min-h-[200px] place-items-center px-6 py-12 text-center text-sm text-muted-foreground">
        No comments yet
      </div>
    );
  }

  return (
    <div>
      {grouped.map(([file, rows]) => (
        <FileGroup
          key={file}
          file={file}
          comments={rows}
          onJump={onJump}
          onDelete={onDelete}
        />
      ))}

      {offPage.length > 0 ? (
        <section className="border-t">
          <h3 className="sticky top-0 z-10 m-0 border-b bg-background/80 px-4 py-2 text-xs italic text-muted-foreground backdrop-blur">
            Off-page or orphaned
          </h3>
          <div className="opacity-90">
            {offPage.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                jumpable={false}
                navigable={canNavigateToPage(c, fileToRoute)}
                onJump={onJump}
                onGoToPage={onGoToPage}
                onDelete={onDelete}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function canNavigateToPage(
  comment: CommentWithFile,
  fileToRoute?: CommentManagementPanelProps["fileToRoute"],
): boolean {
  if (comment.route) return true;
  const file = comment.file;
  if (!file || !fileToRoute) return false;
  return fileToRoute(file, { view: comment.view }) !== null;
}

function FileGroup({
  file,
  comments,
  onJump,
  onDelete,
}: {
  file: string;
  comments: CommentWithFile[];
  onJump: CommentManagementPanelProps["onJump"];
  onDelete: CommentManagementPanelProps["onDelete"];
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b">
      <Button
        type="button"
        variant="ghost"
        className="sticky top-0 z-10 h-auto w-full justify-between rounded-none border-b bg-background/80 px-4 py-2 text-xs text-muted-foreground backdrop-blur hover:bg-muted"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="truncate">{file}</span>
        <span className="flex items-center gap-2">
          <Badge variant="secondary" className="font-normal">
            {comments.length}
          </Badge>
          <Chevron rotated={!open} />
        </span>
      </Button>
      {open ? (
        <div>
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              jumpable
              navigable={false}
              onJump={onJump}
              onGoToPage={() => {}}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CommentRow({
  comment,
  jumpable,
  navigable,
  onJump,
  onGoToPage,
  onDelete,
}: {
  comment: CommentWithFile;
  jumpable: boolean;
  navigable: boolean;
  onJump: CommentManagementPanelProps["onJump"];
  onGoToPage: (comment: CommentWithFile) => void;
  onDelete: CommentManagementPanelProps["onDelete"];
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRowActivate = () => {
    if (jumpable) {
      onJump({ anchor: comment.anchor, instance: 0 });
      return;
    }
    if (navigable) {
      onGoToPage(comment);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete(comment.id);
      // Row unmounts on success; no need to reset state.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      setConfirming(false);
    }
  };

  const interactive = jumpable || navigable;
  const rowClass = cn(
    "group relative flex w-full items-start gap-3 border-t px-4 py-3 text-left transition-colors",
    interactive &&
      "cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    !interactive && "cursor-default",
    busy && "opacity-50",
  );

  const inner = (
    <>
      <Thumbnail src={comment.screenshot} />
      <div className="min-w-0 flex-1">
        <p
          className="m-0 overflow-hidden text-sm leading-snug text-foreground"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {comment.text}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">
            {comment.author}
          </span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {formatRelative(comment.date)}
          </span>
        </div>
        {navigable ? (
          <span className="mt-1 inline-block text-xs text-primary">
            Go to page
          </span>
        ) : null}
        {!jumpable && !navigable && comment.file ? (
          <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
            {comment.file}
          </span>
        ) : null}
        {error ? (
          <p className="m-0 mt-1 text-xs text-destructive">{error}</p>
        ) : null}
      </div>
      <div
        className="flex shrink-0 items-center self-start"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
          aria-label="Delete comment"
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(true);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {confirming ? (
        <div
          className="absolute inset-y-0 right-0 z-10 flex items-center gap-1.5 rounded-r-[inherit] bg-gradient-to-l from-background from-55% to-transparent pl-14 pr-3"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="mr-0.5 text-xs font-medium text-foreground">
            Delete?
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete();
            }}
          >
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      ) : null}
    </>
  );

  if (interactive) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={rowClass}
        onClick={handleRowActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleRowActivate();
          }
        }}
      >
        {inner}
      </div>
    );
  }

  return <div className={rowClass}>{inner}</div>;
}

function Thumbnail({ src }: { src?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className="block h-9 w-9 shrink-0 rounded-md border bg-muted object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="block h-9 w-9 shrink-0 rounded-md border bg-muted"
    />
  );
}

function Chevron({ rotated }: { rotated: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      focusable="false"
      width="9"
      height="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("transition-transform", rotated && "-rotate-90")}
    >
      <polyline points="3,5 8,11 13,5" />
    </svg>
  );
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
