import { ArrowUpRight, Check, MessageSquare, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { CommentData } from "../types.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { DeleteConfirmOverlay } from "./delete-confirm-overlay.tsx";
import { useDeleteConfirm } from "./hooks/use-delete-confirm.ts";

type CommentWithFile = CommentData & { file?: string };
interface AgentRunSummary {
  count: number;
  startedAt: number;
  status?: string;
}

const EMPTY_AGENT_RUNS: ReadonlyMap<string, AgentRunSummary> = new Map();

/** Splits an author handle into name parts for initials. */
const INITIALS_SEPARATOR = /[\s._-]+/;

export interface CommentManagementPanelProps {
  agentRunsByAnchor?: ReadonlyMap<string, AgentRunSummary>;
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
  agentRunsByAnchor = EMPTY_AGENT_RUNS,
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
    return <EmptyState title="No comments yet" />;
  }

  if (visibleTotal === 0) {
    return (
      <EmptyState
        hint="Disable “Hide resolved” in settings to review them."
        title="All comments resolved"
      />
    );
  }

  return (
    <div>
      {grouped.map(([file, rows]) => (
        <FileGroup
          agentRunsByAnchor={agentRunsByAnchor}
          comments={rows}
          file={file}
          key={file}
          onDelete={onDelete}
          onJump={onJump}
        />
      ))}

      {offPage.length > 0 ? (
        <section className="border-t">
          <h3 className="sticky top-0 z-10 m-0 flex items-center gap-2 border-b bg-background/80 px-4 py-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider backdrop-blur">
            Off-page or orphaned
            <span className="font-mono text-[10px] text-muted-foreground/60 normal-case tabular-nums tracking-normal">
              {offPage.length}
            </span>
          </h3>
          <div>
            {offPage.map((c) => (
              <CommentRow
                agentRun={agentRunsByAnchor.get(c.anchor)}
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

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid min-h-[220px] place-items-center px-8 py-12 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full border border-dashed text-muted-foreground/60">
          <MessageSquare className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <p className="m-0 font-medium text-foreground text-sm">{title}</p>
        {hint ? (
          <p className="m-0 max-w-[220px] text-muted-foreground text-xs leading-relaxed">
            {hint}
          </p>
        ) : null}
      </div>
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
  agentRunsByAnchor,
  file,
  comments,
  onJump,
  onDelete,
}: {
  agentRunsByAnchor: ReadonlyMap<string, AgentRunSummary>;
  file: string;
  comments: CommentWithFile[];
  onJump: CommentManagementPanelProps["onJump"];
  onDelete: CommentManagementPanelProps["onDelete"];
}) {
  const [open, setOpen] = useState(true);
  const { dir, base } = splitPath(file);
  return (
    <section className="border-b last:border-b-0">
      <Button
        aria-expanded={open}
        className="sticky top-0 z-10 h-auto w-full justify-between gap-3 rounded-none border-b bg-background/80 px-4 py-2.5 backdrop-blur hover:bg-muted/60"
        onClick={() => setOpen((v) => !v)}
        type="button"
        variant="ghost"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Chevron rotated={!open} />
          <span className="flex min-w-0 items-baseline font-mono text-[11px]">
            {dir ? (
              <span className="truncate text-muted-foreground/55">{dir}</span>
            ) : null}
            <span className="shrink-0 font-medium text-foreground">{base}</span>
          </span>
        </span>
        <span className="grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-muted px-1.5 font-medium text-[10px] text-muted-foreground tabular-nums">
          {comments.length}
        </span>
      </Button>
      {open ? (
        <ul className="m-0 list-none p-0">
          {comments.map((c) => (
            <li key={c.id}>
              <CommentRow
                agentRun={agentRunsByAnchor.get(c.anchor)}
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
  agentRun,
  comment,
  jumpable,
  navigable,
  onJump,
  onGoToPage,
  onDelete,
}: {
  agentRun?: AgentRunSummary;
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
  const resolved = Boolean(comment.resolved);
  const replyCount = comment.replies?.length ?? 0;

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
  const working = Boolean(agentRun);
  const rowClass = cn(
    "group relative flex w-full items-start gap-3 border-t py-3 pr-3 pl-5 text-left transition-colors first:border-t-0",
    interactive &&
      "cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
    !interactive && "cursor-default",
    busy && "opacity-50"
  );

  const inner = (
    <>
      <RowRail
        interactive={interactive}
        resolved={resolved}
        working={working}
      />
      <LeadingVisual author={comment.author} src={comment.screenshot} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "m-0 overflow-hidden text-sm leading-snug",
            resolved ? "text-muted-foreground" : "text-foreground"
          )}
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {comment.text}
        </p>

        <RowMeta
          activeVersion={activeVersion}
          author={comment.author}
          date={comment.date}
          replyCount={replyCount}
          resolved={resolved}
        />

        {agentRun ? <AgentProgress run={agentRun} /> : null}
        {!(jumpable || navigable) && comment.file ? (
          <span className="mt-1.5 block truncate font-mono text-[10px] text-muted-foreground/70">
            {comment.file}
          </span>
        ) : null}
        {error ? (
          <p className="m-0 mt-1 text-destructive text-xs">{error}</p>
        ) : null}
      </div>
      {/* Trailing slot: a "navigates away" arrow at rest swaps to the delete
          control on hover/focus — same footprint, no layout shift. */}
      <div className="relative flex h-7 w-7 shrink-0 items-center justify-center self-start">
        {navigable ? (
          <ArrowUpRight
            aria-hidden
            className="pointer-events-none absolute h-4 w-4 text-muted-foreground/50 transition-opacity group-focus-within:opacity-0 group-hover:opacity-0"
            strokeWidth={2}
          />
        ) : null}
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

/**
 * Leading visual for a row: the cropped screenshot when one exists, otherwise
 * an initials chip in the agent accent — so rows without a capture read as
 * identity rather than an empty placeholder square.
 */
function LeadingVisual({ src, author }: { src?: string; author: string }) {
  if (src) {
    return (
      <span className="mt-0.5 block h-9 w-9 shrink-0 overflow-hidden rounded-md border bg-muted ring-1 ring-black/[0.03]">
        <img
          alt=""
          className="h-full w-full object-cover"
          height={36}
          key={src}
          src={src}
          width={36}
        />
      </span>
    );
  }
  return (
    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[var(--agent-soft)] font-semibold text-[11px] text-[var(--agent)] uppercase">
      {initials(author)}
    </span>
  );
}

/**
 * Left margin-rail — the editorial red-pen accent. Quiet by default; it
 * lights up on hover/focus for interactive rows, glows while the agent works,
 * and reads as a muted fill once the comment is resolved.
 */
function RowRail({
  resolved,
  working,
  interactive,
}: {
  resolved: boolean;
  working: boolean;
  interactive: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute inset-y-0 left-0 w-[3px] transition-colors",
        resolved && "bg-border",
        !resolved && working && "bg-[var(--agent)]",
        !(resolved || working) &&
          interactive &&
          "bg-transparent group-hover:bg-[var(--agent)] group-focus-visible:bg-[var(--agent)]"
      )}
    />
  );
}

/** Author · time on the left; reply / version / resolved signals on the right. */
function RowMeta({
  author,
  date,
  replyCount,
  activeVersion,
  resolved,
}: {
  author: string;
  date: string;
  replyCount: number;
  activeVersion: number;
  resolved: boolean;
}) {
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-xs">
      <span className="truncate text-muted-foreground">
        {authorLabel(author)}
      </span>
      <Dot />
      <time className="shrink-0 font-mono text-[10px] text-muted-foreground/75 tabular-nums">
        {formatRelative(date)}
      </time>
      <span className="flex-1" />
      {replyCount > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
          <MessageSquare className="h-3 w-3" strokeWidth={2} />
          {replyCount}
        </span>
      ) : null}
      {activeVersion > 0 ? (
        <span className="shrink-0 rounded-sm bg-[var(--agent-soft)] px-1 font-medium text-[10px] text-[var(--agent)] tabular-nums">
          v{activeVersion}
        </span>
      ) : null}
      {resolved ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-px font-medium text-[10px] text-muted-foreground">
          <Check className="h-3 w-3" strokeWidth={2.5} />
          Done
        </span>
      ) : null}
    </div>
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40"
    />
  );
}

function AgentProgress({ run }: { run: AgentRunSummary }) {
  const fallback =
    run.count === 1 ? "Agent working…" : `Working on ${run.count} variants…`;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <span className="inline-flex max-w-full items-center gap-1.5 font-medium text-[11px] text-[var(--agent)]">
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--agent)]"
        />
        <span className="truncate">{run.status ?? fallback}</span>
      </span>
      <span
        aria-hidden
        className="relative block h-1 w-full overflow-hidden rounded-full bg-[var(--agent-soft)]"
      >
        <span className="indeterminate absolute inset-y-0 left-0 w-2/5 rounded-full bg-[var(--agent)]" />
      </span>
    </div>
  );
}

function Chevron({ rotated }: { rotated: boolean }) {
  return (
    <svg
      aria-hidden
      className={cn(
        "shrink-0 text-muted-foreground/70 transition-transform",
        rotated && "-rotate-90"
      )}
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

/** Split a repo-relative path into its directory prefix and filename. */
function splitPath(file: string): { dir: string; base: string } {
  const idx = file.lastIndexOf("/");
  if (idx === -1) {
    return { dir: "", base: file };
  }
  return { dir: file.slice(0, idx + 1), base: file.slice(idx + 1) };
}

/** Drop the email domain so authors read as a short, human label. */
function authorLabel(author: string): string {
  const at = author.indexOf("@");
  return at > 0 ? author.slice(0, at) : author;
}

/** Two-letter initials from an author handle or email local-part. */
function initials(author: string): string {
  const local = authorLabel(author).trim();
  if (!local) {
    return "?";
  }
  const parts = local.split(INITIALS_SEPARATOR).filter(Boolean);
  if (parts.length === 0) {
    return local.slice(0, 2);
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2);
  }
  return parts[0][0] + (parts.at(-1) as string)[0];
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
