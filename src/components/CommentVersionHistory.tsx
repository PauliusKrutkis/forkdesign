import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/utils";
import { AdaptiveThumb } from "./comment-thumb";
import { HotkeyTip } from "./HotkeyTip";
import type { CommentReply } from "./types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { IterationsData, IterationVersion } from "./useIterations";

interface CommentVersionHistoryProps {
  active: number;
  disabled?: boolean;
  onActivate: (v: number) => void;
  onDeleteVersion?: (v: number) => Promise<void>;
  onThumbClick?: (src: string) => void;
  renderReply: (reply: CommentReply, replyIndex: number) => React.ReactNode;
  replies?: CommentReply[];
  switching?: boolean;
  versions: IterationVersion[];
}

/** User-facing version label (1-based), e.g. `v2`. */
export function formatVersionDisplay(v: number): string {
  return `v${v + 1}`;
}

type TimelineItem =
  | {
      kind: "reply";
      reply: CommentReply;
      replyIndex: number;
      sortKey: number;
    }
  | { kind: "version"; version: IterationVersion; sortKey: number };

function parseSortKey(iso: string | undefined): number {
  if (!iso) {
    return 0;
  }
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? 0 : ts;
}

function compareTimelineItems(a: TimelineItem, b: TimelineItem): number {
  if (b.sortKey !== a.sortKey) {
    return b.sortKey - a.sortKey;
  }
  if (a.kind === "reply" && b.kind === "reply") {
    return b.replyIndex - a.replyIndex;
  }
  if (a.kind === "version" && b.kind === "version") {
    return b.version.v - a.version.v;
  }
  if (a.kind === "reply" && b.kind === "version") {
    return -1;
  }
  return 1;
}

export function CommentVersionHistory({
  versions,
  active,
  replies = [],
  renderReply,
  onActivate,
  onDeleteVersion,
  onThumbClick,
  switching = false,
  disabled = false,
}: CommentVersionHistoryProps) {
  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];

    for (const version of versions) {
      items.push({
        kind: "version",
        version,
        sortKey: parseSortKey(version.createdAt),
      });
    }

    for (let i = 0; i < replies.length; i++) {
      const reply = replies[i];
      if (!reply) {
        continue;
      }
      items.push({
        kind: "reply",
        reply,
        replyIndex: i,
        sortKey: parseSortKey(reply.date),
      });
    }

    items.sort(compareTimelineItems);
    return items;
  }, [replies, versions]);

  const hasContent = timeline.length > 0 || replies.some(Boolean);

  if (!hasContent) {
    return null;
  }

  return (
    <div className="mt-3 border-t pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="m-0 font-medium text-foreground text-xs">History</h3>
        {versions.length > 1 ? (
          <HotkeyTip keys="← →" label="Change version" side="left">
            <span className="text-[10px] text-muted-foreground">← →</span>
          </HotkeyTip>
        ) : null}
      </div>
      <ul className="m-0 list-none space-y-2.5 p-0">
        {timeline.map((item) =>
          item.kind === "reply" ? (
            <li key={`reply-${item.replyIndex}`}>
              {renderReply(item.reply, item.replyIndex)}
            </li>
          ) : (
            <li key={`version-${item.version.v}`}>
              <VersionHistoryRow
                active={active}
                canDelete={item.version.v > 0 && Boolean(onDeleteVersion)}
                disabled={disabled}
                onActivate={onActivate}
                onDeleteVersion={onDeleteVersion}
                onThumbClick={onThumbClick}
                switching={switching}
                version={item.version}
              />
            </li>
          )
        )}
      </ul>
    </div>
  );
}

function VersionHistoryRow({
  version,
  active,
  onActivate,
  onDeleteVersion,
  onThumbClick,
  switching,
  disabled,
  canDelete,
}: {
  version: IterationVersion;
  active: number;
  onActivate: (v: number) => void;
  onDeleteVersion?: (v: number) => Promise<void>;
  onThumbClick?: (src: string) => void;
  switching: boolean;
  disabled: boolean;
  canDelete: boolean;
}) {
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const isActive = version.v === active;
  const label = version.v === 0 ? "Baseline" : "Fix";

  const requestDelete = () => {
    if (!onDeleteVersion || deleteBusy || disabled) {
      return;
    }
    setDeleteConfirming(true);
  };

  const cancelDelete = () => {
    setDeleteConfirming(false);
  };

  const confirmDelete = async () => {
    if (!onDeleteVersion || deleteBusy) {
      return;
    }
    setDeleteBusy(true);
    try {
      await onDeleteVersion(version.v);
      setDeleteConfirming(false);
    } catch {
      setDeleteConfirming(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "border-l-2 pl-2.5",
        isActive ? "border-primary" : "border-border"
      )}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              className="h-5 px-1.5 font-normal text-[10px]"
              variant="outline"
            >
              {label}
            </Badge>
            <span className="font-mono text-muted-foreground text-xs tabular-nums">
              {formatVersionDisplay(version.v)}
            </span>
            {isActive ? (
              <span className="font-medium text-[10px] text-primary">
                Live on page
              </span>
            ) : null}
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
              {formatTimelineDate(version.createdAt)}
            </span>
          </div>
          {deleteConfirming ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-foreground text-xs">
                Delete {formatVersionDisplay(version.v)}?
              </span>
              <Button
                className="h-7 px-2 text-xs"
                disabled={deleteBusy}
                onClick={cancelDelete}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                className="h-7 px-2 text-xs"
                disabled={deleteBusy}
                onClick={() => void confirmDelete()}
                size="sm"
                type="button"
                variant="destructive"
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {isActive ? null : (
                <Button
                  className="h-7 px-2 text-xs"
                  disabled={disabled || switching}
                  onClick={() => onActivate(version.v)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {switching ? "Switching…" : "Use this version"}
                </Button>
              )}
              {canDelete ? (
                <Button
                  className="h-7 gap-1 px-2 text-xs hover:bg-destructive/10 hover:text-destructive"
                  disabled={disabled || switching || deleteBusy}
                  onClick={requestDelete}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  Delete
                </Button>
              ) : null}
            </div>
          )}
        </div>
        <AdaptiveThumb
          onClick={onThumbClick ? () => onThumbClick(version.png) : undefined}
          src={version.png}
        />
      </div>
    </div>
  );
}

function formatTimelineDate(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return "";
  }
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function shouldShowVersionHistory(data: IterationsData | null): boolean {
  return (data?.versions.length ?? 0) > 1;
}

/** True when the comment has 2+ fix versions (uses marker `active` while API loads). */
export function hasMultipleVersions(
  iterations: IterationsData | null,
  activeOnMarker?: number
): boolean {
  if (iterations) {
    return shouldShowVersionHistory(iterations);
  }
  return (activeOnMarker ?? 0) > 0;
}
