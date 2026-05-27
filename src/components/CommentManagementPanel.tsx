import { useEffect, useMemo, useRef, useState } from "react";
import type { CommentData } from "./types";

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

/**
 * Comment list body for CommentShell. On-page rows jump to the pin; off-page
 * rows navigate via stored `route` or optional `fileToRoute` when available.
 */
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
      <div className="grid min-h-[200px] place-items-center px-6 py-12 text-center font-[var(--co-font-mono)] text-[11px] uppercase tracking-[0.06em] text-[var(--co-ink-3)]">
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
        <section className="border-t border-[var(--co-line)]">
          <h3 className="m-0 px-4 py-2 font-[var(--co-font-mono)] text-[10px] italic uppercase tracking-[0.06em] text-[var(--co-ink-3)]">
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
    <section className="border-b border-[var(--co-line)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--co-ink-3)] transition-colors hover:bg-[var(--co-surface-2)]"
        aria-expanded={open}
      >
        <span className="truncate">{file}</span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums">{comments.length}</span>
          <Chevron rotated={!open} />
        </span>
      </button>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

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
    setMenuOpen(false);
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this comment?")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onDelete(comment.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const interactive = jumpable || navigable;
  const rowClass = `group relative flex w-full items-start gap-3 border-t border-[var(--co-line)] px-4 py-3 text-left transition-colors ${
    interactive
      ? "cursor-pointer hover:bg-[var(--co-surface-2)]"
      : "cursor-default"
  } ${busy ? "opacity-50" : ""}`;

  const inner = (
    <>
      <Thumbnail src={comment.screenshot} />
      <div className="min-w-0 flex-1">
        <p
          className="m-0 overflow-hidden text-[12.5px] leading-[1.4] text-[var(--co-ink)]"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {comment.text}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.04em] text-[var(--co-ink-3)]">
          <span className="truncate">{comment.author}</span>
          <span className="shrink-0 tabular-nums text-[var(--co-ink-4)]">
            {formatRelative(comment.date)}
          </span>
        </div>
        {navigable ? (
          <span className="mt-1 inline-block font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.04em] text-[var(--co-sev-info)]">
            Go to page
          </span>
        ) : null}
        {!jumpable && !navigable && comment.file ? (
          <span className="mt-1 block truncate font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.04em] text-[var(--co-ink-4)]">
            {comment.file}
          </span>
        ) : null}
        {error ? (
          <p className="m-0 mt-1 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.04em] text-[var(--co-sev-critical)]">
            {error}
          </p>
        ) : null}
      </div>
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          aria-label="Comment actions"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="grid h-7 w-7 place-items-center rounded-[4px] text-[var(--co-ink-3)] transition-colors hover:bg-[var(--co-surface-3)] hover:text-[var(--co-ink)]"
        >
          <span aria-hidden className="text-[16px] leading-none">
            …
          </span>
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-8 z-10 min-w-[120px] rounded-[6px] border border-[var(--co-line-strong)] bg-[var(--co-surface)] py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                void handleDelete();
              }}
              className="block w-full px-3 py-1.5 text-left font-[var(--co-font-mono)] text-[11px] uppercase tracking-[0.04em] text-[var(--co-sev-critical)] transition-colors hover:bg-[var(--co-sev-critical-bg)]"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </>
  );

  if (interactive) {
    return (
      <button type="button" className={rowClass} onClick={handleRowActivate}>
        {inner}
      </button>
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
        className="block h-9 w-9 shrink-0 rounded-[4px] border border-[var(--co-line)] bg-[var(--co-surface-3)] object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="block h-9 w-9 shrink-0 rounded-[4px] border border-[var(--co-line)] bg-gradient-to-br from-[var(--co-surface-3)] to-[var(--co-surface-2)]"
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
      className={`transition-transform ${rotated ? "-rotate-90" : ""}`}
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
