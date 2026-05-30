import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/utils";
import { AdaptiveThumb } from "./comment-thumb";
import { HotkeyTip } from "./HotkeyTip";
import type { CommentReply } from "./types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { IterationsData, IterationVersion } from "./useIterations";

type TimelineItem =
  | { kind: "reply"; date: string; reply: CommentReply; replyIndex: number }
  | { kind: "version"; date: string; version: IterationVersion };

interface CommentVersionHistoryProps {
  active: number;
  disabled?: boolean;
  onActivate: (v: number) => void;
  onThumbClick?: (src: string) => void;
  renderReply: (reply: CommentReply, replyIndex: number) => React.ReactNode;
  replies?: CommentReply[];
  switching?: boolean;
  versions: IterationVersion[];
}

export function CommentVersionHistory({
  versions,
  active,
  replies = [],
  renderReply,
  onActivate,
  onThumbClick,
  switching = false,
  disabled = false,
}: CommentVersionHistoryProps) {
  const items = useMemo(() => {
    const list: TimelineItem[] = [];
    for (let i = 0; i < replies.length; i++) {
      const reply = replies[i];
      if (!reply) {
        continue;
      }
      list.push({
        kind: "reply",
        date: reply.date,
        reply,
        replyIndex: i,
      });
    }
    for (const version of versions) {
      list.push({
        kind: "version",
        date: version.createdAt ?? new Date(0).toISOString(),
        version,
      });
    }
    list.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    return list;
  }, [replies, versions]);

  if (items.length === 0) {
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
        {items.map((item) =>
          item.kind === "reply" ? (
            <li key={`reply-${item.replyIndex}`}>
              {renderReply(item.reply, item.replyIndex)}
            </li>
          ) : (
            <VersionHistoryRow
              active={active}
              disabled={disabled}
              key={`version-${item.version.v}`}
              onActivate={onActivate}
              onThumbClick={onThumbClick}
              switching={switching}
              version={item.version}
            />
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
  onThumbClick,
  switching,
  disabled,
}: {
  version: IterationVersion;
  active: number;
  onActivate: (v: number) => void;
  onThumbClick?: (src: string) => void;
  switching: boolean;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isActive = version.v === active;
  const summary = version.summary ?? (version.v === 0 ? "Baseline" : "AI fix");
  const label = version.v === 0 ? "Baseline" : "Fix";

  return (
    <li
      className={cn(
        "border-l-2 pl-2.5",
        isActive ? "border-primary" : "border-border"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              className="h-5 px-1.5 font-normal text-[10px]"
              variant="outline"
            >
              {label}
            </Badge>
            <span className="font-mono text-muted-foreground text-xs tabular-nums">
              v{version.v + 1}
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
          <button
            className="mt-1 flex w-full items-start gap-1 text-left"
            onClick={() => setExpanded((prev) => !prev)}
            type="button"
          >
            <p
              className={cn(
                "m-0 flex-1 text-muted-foreground text-sm leading-snug",
                !expanded && "line-clamp-2"
              )}
            >
              {summary}
            </p>
            {summary.length > 60 ? (
              <span className="mt-0.5 shrink-0 text-muted-foreground">
                {expanded ? (
                  <ChevronUp aria-hidden className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown aria-hidden className="h-3.5 w-3.5" />
                )}
              </span>
            ) : null}
          </button>
          {isActive ? null : (
            <Button
              className="mt-2 h-7 px-2 text-xs"
              disabled={disabled || switching}
              onClick={() => onActivate(version.v)}
              size="sm"
              type="button"
              variant="outline"
            >
              {switching ? "Switching…" : "Use this version"}
            </Button>
          )}
        </div>
        <AdaptiveThumb
          onClick={onThumbClick ? () => onThumbClick(version.png) : undefined}
          src={version.png}
        />
      </div>
    </li>
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
