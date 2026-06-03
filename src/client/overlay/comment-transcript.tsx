import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { CommentData } from "../types.ts";
import { ReplyVersionBadge } from "./comment-bubble-attribution.tsx";
import { TranscriptHumanEntry } from "./comment-transcript-human.tsx";
import { CommentVariantGroup } from "./comment-variant-group.tsx";
import type { IterationsData } from "./hooks/use-iterations.ts";
import { formatElapsed } from "./lib/bubble-formatters.ts";
import { buildTranscript } from "./lib/build-transcript.ts";

interface CommentTranscriptProps {
  activeVersion: number;
  fixVersionCount: number;
  iterateNow: number;
  iterateStartedAt: number | null;
  iterateStatus: string | null;
  iterating: boolean;
  iterations: IterationsData | null;
  lead: CommentData;
  onActivateVersion: (v: number) => Promise<void>;
  onDeleteReply?: (id: string, replyIndex: number) => Promise<void>;
  onEditComment?: (id: string, text: string) => Promise<void>;
  onEditReply?: (id: string, replyIndex: number, text: string) => Promise<void>;
  onRemoveVersion: (v: number) => void | Promise<void>;
  onResetInlineFlows?: () => void;
  onThumbClick: (src: string) => void;
  skipDeleteConfirmation: boolean;
  versionDeleteError: string | null;
  versionDeleting: boolean;
  versionSwitching: boolean;
}

/**
 * The comment rendered as a conversation: the original note, the agent's
 * variant groups, and replies interleaved by time, oldest first. A persistent
 * composer lives below this (in the bubble shell). Auto-scrolls to the newest
 * entry on open and whenever the conversation grows or a fix starts streaming.
 */
export function CommentTranscript({
  lead,
  iterations,
  activeVersion,
  onEditComment,
  onEditReply,
  onDeleteReply,
  onResetInlineFlows,
  skipDeleteConfirmation,
  onActivateVersion,
  onRemoveVersion,
  versionSwitching,
  versionDeleting,
  versionDeleteError,
  onThumbClick,
  iterating,
  iterateStatus,
  iterateStartedAt,
  iterateNow,
  fixVersionCount,
}: CommentTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const entries = useMemo(
    () =>
      buildTranscript({
        id: lead.id,
        text: lead.text,
        author: lead.author,
        date: lead.date,
        replies: lead.replies,
        versions: iterations?.versions ?? [],
      }),
    [lead.id, lead.text, lead.author, lead.date, lead.replies, iterations]
  );

  // Stick to the bottom as the conversation grows / a fix streams in. The
  // dependencies are intentional triggers, not values read in the body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on growth/stream
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries.length, iterating]);

  return (
    <div
      className="redline-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5"
      ref={scrollRef}
    >
      {entries.map((entry) => {
        if (entry.kind === "comment") {
          return (
            <TranscriptHumanEntry
              ariaLabel="Edit comment"
              author={entry.author}
              date={entry.date}
              emptyMessage="Comment cannot be empty"
              key="comment"
              onEdit={
                onEditComment
                  ? (text) => onEditComment(entry.id, text)
                  : undefined
              }
              skipDeleteConfirmation={skipDeleteConfirmation}
              text={entry.text}
            />
          );
        }
        if (entry.kind === "reply") {
          const { replyIndex, reply } = entry;
          return (
            <TranscriptHumanEntry
              ariaLabel="Edit reply"
              author={reply.author}
              badge={<ReplyVersionBadge v={reply.v} />}
              date={reply.date}
              emptyMessage="Reply cannot be empty"
              key={`reply-${replyIndex}-${reply.date}`}
              onDelete={
                onDeleteReply
                  ? () => onDeleteReply(lead.id, replyIndex)
                  : undefined
              }
              onEdit={
                onEditReply
                  ? (text) => onEditReply(lead.id, replyIndex, text)
                  : undefined
              }
              onInteraction={onResetInlineFlows}
              skipDeleteConfirmation={skipDeleteConfirmation}
              text={reply.text}
            />
          );
        }
        return (
          <CommentVariantGroup
            active={activeVersion}
            createdAt={entry.createdAt}
            deleting={versionDeleting}
            isBaseline={entry.isBaseline}
            key={`variants-${entry.versions.map((v) => v.v).join("-")}`}
            onActivate={(v) => {
              onActivateVersion(v).catch(() => {
                // surfaced via the hook's own state; nothing to do here
              });
            }}
            onRemoveVersion={onRemoveVersion}
            onThumbClick={onThumbClick}
            switching={versionSwitching}
            versions={entry.versions}
          />
        );
      })}

      {versionDeleteError ? (
        <p className="m-0 text-destructive text-xs" role="alert">
          {versionDeleteError}
        </p>
      ) : null}

      {iterating ? (
        <ThinkingEntry
          count={fixVersionCount}
          iterateNow={iterateNow}
          iterateStartedAt={iterateStartedAt}
          status={iterateStatus}
        />
      ) : null}
    </div>
  );
}

function ThinkingEntry({
  status,
  iterateStartedAt,
  iterateNow,
  count,
}: {
  status: string | null;
  iterateStartedAt: number | null;
  iterateNow: number;
  count: number;
}) {
  return (
    <div className="flex gap-2.5">
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
      <div className="min-w-0 flex-1">
        <div
          aria-live="polite"
          className="flex items-center gap-2 text-muted-foreground text-xs"
          role="status"
        >
          {iterateStartedAt === null ? null : (
            <span className="font-mono tabular-nums">
              {formatElapsed(iterateNow - iterateStartedAt)}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">
            {status ?? "Working…"}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {Array.from({ length: Math.max(1, count) }, (_, i) => (
            <div
              className="redline-shimmer h-[7.5rem] rounded-lg border"
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton
              key={i}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
