import { useEffect, useMemo, useRef, useState } from "react";
import type { CommentData } from "./types";

/**
 * The bulk-fetch endpoint stamps `file` onto each row so the panel can group
 * comments by source path. Locally we widen CommentData to make that field
 * known to TypeScript without altering the shared type used by the in-page
 * overlay primitives.
 */
type CommentWithFile = CommentData & { file?: string };

type CommentManagementPanelProps = {
  /** All comments across the project, already bulk-fetched in CommentOverlay. */
  comments: CommentData[];
  /**
   * Anchors currently present in the DOM. Used to split the list into
   * on-page rows (clickable, jump-to-bubble) and off-page/orphaned rows
   * (still deletable, but no live anchor to jump to).
   */
  inDomAnchors: Set<string>;
  /** Open the bubble at this comment's anchor. Closes the panel. */
  onJump: (target: { anchor: string; instance: number }) => void;
  /** DELETE the comment from source. Resolves once the request completes. */
  onDelete: (id: string) => Promise<void>;
  /** Close the panel. Fires on X click and on Esc. */
  onClose: () => void;
};

/**
 * Right-side drawer that lists every comment in the project. Rows show the
 * comment's screenshot thumbnail (when present), body, author, and date.
 * Clicking a row jumps to the comment's anchor — sets `openTarget` upstream
 * and dismisses the panel.
 *
 * Layout:
 *   - On-page section, grouped by source file.
 *   - Off-page / orphaned section at the bottom, visually de-emphasized.
 *   - Per-row "..." menu exposing a Delete action (red).
 *
 * Visual tokens come from the existing app theme: surface variants, ink
 * hierarchy, line-strong borders, font-mono uppercase labels.
 */
export function CommentManagementPanel({
  comments,
  inDomAnchors,
  onJump,
  onDelete,
  onClose,
}: CommentManagementPanelProps) {
  // Bind Esc locally so the panel always responds even when the bubble is
  // closed (the overlay's global Esc handler only fires when a bubble is
  // open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const withFile = comments as CommentWithFile[];

  // Split: in-DOM (live anchor) vs orphaned (anchor not in current page).
  const { onPage, offPage } = useMemo(() => {
    const on: CommentWithFile[] = [];
    const off: CommentWithFile[] = [];
    for (const c of withFile) {
      if (inDomAnchors.has(c.anchor)) on.push(c);
      else off.push(c);
    }
    // Newest first inside each bucket.
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

  return (
    <aside
      data-comment-overlay="true"
      role="dialog"
      aria-label="Comment list"
      className="pointer-events-auto fixed inset-y-0 right-0 z-[9250] flex w-[360px] animate-[slideInRight_220ms_ease-out] flex-col border-l border-[var(--co-line-strong)] bg-[var(--co-surface)] shadow-2xl"
      // `animate-[slideInRight…]` inlines a keyframe via Tailwind's arbitrary
      // animation syntax — falls back to no animation in case the keyframe
      // wasn't registered.
      style={{ animationName: "slideInRight" }}
      onClick={(e) => e.stopPropagation()}
    >
      <style>{`@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

      <header className="flex shrink-0 items-center justify-between border-b border-[var(--co-line)] bg-[var(--co-surface-2)] px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-[var(--co-font-mono)] text-[11px] uppercase tracking-[var(--co-tracking-micro)] text-[var(--co-ink-2)]">
            Comments
            <span className="ml-2 tabular-nums text-[var(--co-ink-3)]">· {total}</span>
          </span>
          <span className="font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--co-ink-3)]">
            {onPage.length} on this page · {offPage.length} elsewhere
          </span>
        </div>
        <button
          type="button"
          aria-label="Close comment list"
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] text-[var(--co-ink-2)] transition-colors hover:bg-[var(--co-surface-3)] hover:text-[var(--co-ink)]"
        >
          <span aria-hidden className="text-[15px] leading-none">
            ×
          </span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {total === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center font-[var(--co-font-mono)] text-[11px] uppercase tracking-[0.06em] text-[var(--co-ink-3)]">
            No comments yet
          </div>
        ) : (
          <>
            {grouped.map(([file, rows]) => (
              <FileGroup
                key={file}
                file={file}
                comments={rows}
                onJump={onJump}
                onDelete={onDelete}
                onClose={onClose}
              />
            ))}

            {offPage.length > 0 ? (
              <section className="border-t border-[var(--co-line)]">
                <h3 className="m-0 px-4 py-2 font-[var(--co-font-mono)] text-[10px] italic uppercase tracking-[0.06em] text-[var(--co-ink-3)]">
                  Off-page or orphaned
                </h3>
                <div className="opacity-60">
                  {offPage.map((c) => (
                    <CommentRow
                      key={c.id}
                      comment={c}
                      jumpable={false}
                      onJump={onJump}
                      onDelete={onDelete}
                      onClose={onClose}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

function FileGroup({
  file,
  comments,
  onJump,
  onDelete,
  onClose,
}: {
  file: string;
  comments: CommentWithFile[];
  onJump: CommentManagementPanelProps["onJump"];
  onDelete: CommentManagementPanelProps["onDelete"];
  onClose: () => void;
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
              onJump={onJump}
              onDelete={onDelete}
              onClose={onClose}
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
  onJump,
  onDelete,
  onClose,
}: {
  comment: CommentWithFile;
  jumpable: boolean;
  onJump: CommentManagementPanelProps["onJump"];
  onDelete: CommentManagementPanelProps["onDelete"];
  onClose: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the action menu on outside click.
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
    if (!jumpable) return;
    onJump({ anchor: comment.anchor, instance: 0 });
    onClose();
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    // window.confirm is a deliberate v1 trade-off — keeps the panel focused
    // on layout, not modal plumbing.
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
      // HMR will refresh the list; the row will simply disappear on rerender.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`group relative flex items-start gap-3 border-t border-[var(--co-line)] px-4 py-3 transition-colors ${
        jumpable ? "cursor-pointer hover:bg-[var(--co-surface-2)]" : "cursor-default"
      } ${busy ? "opacity-50" : ""}`}
      onClick={handleRowActivate}
      role={jumpable ? "button" : undefined}
      tabIndex={jumpable ? 0 : -1}
      onKeyDown={(e) => {
        if (!jumpable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleRowActivate();
        }
      }}
    >
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
        <div className="mt-1 flex items-center justify-between gap-2 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.04em] text-[var(--co-ink-3)]">
          <span className="truncate">{comment.author}</span>
          <span className="shrink-0 tabular-nums text-[var(--co-ink-4)]">
            {formatRelative(comment.date)}
          </span>
        </div>
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
    </div>
  );
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

/**
 * Compact "just now / 5m / 2h / 3d / Mar 4" relative date used in the list
 * rows. The bubble itself prefers a longer time-of-day format; here we want
 * something that fits next to a truncated author.
 */
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
