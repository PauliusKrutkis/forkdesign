import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { CommentData } from "../types.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { MicroThumb } from "./comment-thumb.tsx";
import { DeleteConfirmOverlay } from "./delete-confirm-overlay.tsx";
import { useDeleteConfirm } from "./hooks/use-delete-confirm.ts";

type CommentWithFile = CommentData & { file?: string };

export interface CommentManagementPanelProps {
  comments: CommentData[];
  fileToRoute?: (file: string, ctx: { view?: string | null }) => string | null;
  hideResolved?: boolean;
  inDomAnchors: Set<string>;
  onDelete: (
    id: string,
    options?: { revertBaseline?: boolean }
  ) => Promise<void>;
  onGoToPage: (comment: CommentWithFile) => void;
  onJump: (target: { anchor: string; instance: number }) => void;
}

export function CommentManagementPanel({
  comments,
  inDomAnchors,
  onJump,
  onGoToPage,
  fileToRoute,
  onDelete,
  hideResolved = false,
}: CommentManagementPanelProps) {
  const withFile = comments as CommentWithFile[];
  const visibleComments = useMemo(() => {
    if (!hideResolved) {
      return withFile;
    }
    return withFile.filter((c) => !c.resolved);
  }, [withFile, hideResolved]);

  const { onPage, offPage } = useMemo(() => {
    const on: CommentWithFile[] = [];
    const off: CommentWithFile[] = [];
    for (const c of visibleComments) {
      if (inDomAnchors.has(c.anchor)) {
        on.push(c);
      } else {
        off.push(c);
      }
    }
    const byDate = (a: CommentWithFile, b: CommentWithFile) =>
      Date.parse(b.date) - Date.parse(a.date);
    on.sort(byDate);
    off.sort(byDate);
    return { onPage: on, offPage: off };
  }, [visibleComments, inDomAnchors]);

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
  const visibleTotal = visibleComments.length;

  if (total === 0) {
    return (
      <div className="grid min-h-[200px] place-items-center px-6 py-12 text-center text-muted-foreground text-sm">
        No comments yet
      </div>
    );
  }

  if (visibleTotal === 0) {
    return (
      <div className="grid min-h-[200px] place-items-center px-6 py-12 text-center text-muted-foreground text-sm">
        All comments resolved — disable Hide resolved in settings to review.
      </div>
    );
  }

  return (
    <div>
      {grouped.map(([file, rows]) => (
        <FileGroup
          comments={rows}
          file={file}
          key={file}
          onDelete={onDelete}
          onJump={onJump}
        />
      ))}

      {offPage.length > 0 ? (
        <section className="border-t">
          <h3 className="sticky top-0 z-10 m-0 border-b bg-background/80 px-4 py-2 text-muted-foreground text-xs italic backdrop-blur">
            Off-page or orphaned
          </h3>
          <div className="opacity-90">
            {offPage.map((c) => (
              <CommentRow
                comment={c}
                jumpable={false}
                key={c.id}
                navigable={canNavigateToPage(c, fileToRoute)}
                onDelete={onDelete}
                onGoToPage={onGoToPage}
                onJump={onJump}
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
  fileToRoute?: CommentManagementPanelProps["fileToRoute"]
): boolean {
  if (comment.route) {
    return true;
  }
  const file = comment.file;
  if (!(file && fileToRoute)) {
    return false;
  }
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
        aria-expanded={open}
        className="sticky top-0 z-10 h-auto w-full justify-between rounded-none border-b bg-background/80 px-4 py-2 text-muted-foreground text-xs backdrop-blur hover:bg-muted"
        onClick={() => setOpen((v) => !v)}
        type="button"
        variant="ghost"
      >
        <span className="truncate">{file}</span>
        <span className="flex items-center gap-2">
          <Badge className="font-normal" variant="secondary">
            {comments.length}
          </Badge>
          <Chevron rotated={!open} />
        </span>
      </Button>
      {open ? (
        <ul className="m-0 list-none p-0">
          {comments.map((c) => (
            <li key={c.id}>
              <CommentRow
                comment={c}
                jumpable
                navigable={false}
                onDelete={onDelete}
                onGoToPage={() => undefined}
                onJump={onJump}
              />
            </li>
          ))}
        </ul>
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
  const [revertBaseline, setRevertBaseline] = useState(false);
  const activeVersion = comment.active ?? 0;
  const showRevertOption = activeVersion > 0;

  const {
    confirming,
    busy,
    error,
    requestDelete,
    confirmDelete,
    cancelDelete,
  } = useDeleteConfirm({
    onDelete: async () => {
      await onDelete(comment.id, {
        revertBaseline: showRevertOption ? revertBaseline : false,
      });
    },
  });

  const handleRequestDelete = () => {
    setRevertBaseline(false);
    requestDelete();
  };

  const handleCancelDelete = () => {
    setRevertBaseline(false);
    cancelDelete();
  };

  const handleRowActivate = () => {
    if (jumpable) {
      onJump({ anchor: comment.anchor, instance: 0 });
      return;
    }
    if (navigable) {
      onGoToPage(comment);
    }
  };

  const interactive = jumpable || navigable;
  const rowClass = cn(
    "group relative flex w-full items-start gap-3 border-t px-4 py-3 text-left transition-colors",
    interactive &&
      "cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
    !interactive && "cursor-default",
    busy && "opacity-50"
  );

  const inner = (
    <>
      <MicroThumb src={comment.screenshot} />
      <div className="min-w-0 flex-1">
        <p
          className="m-0 overflow-hidden text-foreground text-sm leading-snug"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {comment.text}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <span className="truncate text-muted-foreground text-xs">
            {comment.author}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
            {formatRelative(comment.date)}
          </span>
        </div>
        {navigable ? (
          <span className="mt-1 inline-block text-primary text-xs">
            Go to page
          </span>
        ) : null}
        {!(jumpable || navigable) && comment.file ? (
          <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
            {comment.file}
          </span>
        ) : null}
        {error ? (
          <p className="m-0 mt-1 text-destructive text-xs">{error}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center self-start">
        <Button
          aria-label="Delete comment"
          className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            handleRequestDelete();
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {confirming ? (
        <DeleteConfirmOverlay
          activeVersion={activeVersion}
          busy={busy}
          layout="panel"
          onCancel={handleCancelDelete}
          onConfirm={async () => {
            await confirmDelete();
          }}
          onRevertBaselineChange={setRevertBaseline}
          revertBaseline={revertBaseline}
          showRevertOption={showRevertOption}
        />
      ) : null}
    </>
  );

  if (interactive) {
    return (
      <button className={rowClass} onClick={handleRowActivate} type="button">
        {inner}
      </button>
    );
  }

  return <div className={rowClass}>{inner}</div>;
}

function Chevron({ rotated }: { rotated: boolean }) {
  return (
    <svg
      aria-hidden
      className={cn("transition-transform", rotated && "-rotate-90")}
      fill="none"
      focusable="false"
      height="9"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 16 16"
      width="9"
    >
      <title>{rotated ? "Collapse section" : "Expand section"}</title>
      <polyline points="3,5 8,11 13,5" />
    </svg>
  );
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return iso;
  }
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) {
    return "just now";
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min}m`;
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return `${hr}h`;
  }
  const day = Math.round(hr / 24);
  if (day < 7) {
    return `${day}d`;
  }
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
