import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { OverlayModel } from "../settings.ts";
import type { CommentData } from "../types.ts";
import { ReplyVersionBadge } from "./comment-bubble-attribution.tsx";
import type { ComposerMode } from "./comment-composer-bar.tsx";
import { TranscriptHumanEntry } from "./comment-transcript-human.tsx";
import { VariantGrid } from "./comment-variant-group.tsx";
import type {
  IterationsData,
  IterationVersion,
} from "./hooks/use-iterations.ts";
import { formatElapsed } from "./lib/bubble-formatters.ts";
import type {
  TranscriptTurn,
  TurnInstruction,
} from "./lib/build-transcript.ts";
import { buildTranscript } from "./lib/build-transcript.ts";
import { commentMayHaveFixVersions } from "./lib/comment-may-have-fix-versions.ts";
import type { TranscriptEditSubmit } from "./transcript-entry-composer.tsx";

function defaultEditModeForInstruction(
  instruction: TurnInstruction,
  hasAgentHistory: boolean
): ComposerMode {
  if (instruction.kind === "comment") {
    return hasAgentHistory ? "agent" : "comment";
  }
  return instruction.reply.v === undefined ? "comment" : "agent";
}

interface CommentTranscriptProps {
  activeVersion: number;
  editingEntryKey: string | null;
  fixModel: OverlayModel;
  fixVersionCount: number;
  hasAgentHistory: boolean;
  iterateNow: number;
  iterateStartedAt: number | null;
  iterateStatus: string | null;
  iterating: boolean;
  iterations: IterationsData | null;
  /** True while the versions manifest is fetching (e.g. on bubble open). */
  iterationsLoading?: boolean;
  lead: CommentData;
  onActivateVersion: (v: number) => Promise<void>;
  onEditComment?: (payload: TranscriptEditSubmit) => Promise<void>;
  onEditingEntryKeyChange: (key: string | null) => void;
  onEditReply?: (
    id: string,
    replyIndex: number,
    payload: TranscriptEditSubmit
  ) => Promise<void>;
  onFixModelChange: (model: OverlayModel) => void;
  onRemoveVersion: (v: number) => void | Promise<void>;
  onResetInlineFlows?: () => void;
  onThumbClick: (src: string) => void;
  versionDeleteError: string | null;
  versionDeleting: boolean;
  versionSwitching: boolean;
}

/**
 * The comment as a conversation of turns: each instruction (comment or reply)
 * with the agent runs it produced grouped beneath it.
 */
export function CommentTranscript({
  lead,
  iterations,
  activeVersion,
  hasAgentHistory,
  editingEntryKey,
  onEditingEntryKeyChange,
  onEditComment,
  onEditReply,
  onResetInlineFlows,
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
  fixModel,
  fixVersionCount,
  onFixModelChange,
  iterationsLoading = false,
}: CommentTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const transcript = useMemo(
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

  const turnCount = transcript.turns.length;
  const mayHaveFixVersions = commentMayHaveFixVersions(lead);
  // The baseline rides along as the leading "before" card in the first turn
  // that produced variants, so Original sits beside the new version(s).
  const firstRunTurnKey = transcript.turns.find((t) => t.runs.length > 0)?.key;

  // Stick to the bottom as the conversation grows / a fix streams in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on growth/stream
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [turnCount, iterating, iterationsLoading, editingEntryKey]);

  return (
    <div
      className="redline-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5"
      ref={scrollRef}
    >
      {transcript.turns.map((turn) => (
        <TurnView
          activeVersion={activeVersion}
          baseline={
            turn.key === firstRunTurnKey ? transcript.baseline : undefined
          }
          editingEntryKey={editingEntryKey}
          fixModel={fixModel}
          fixVersionCount={fixVersionCount}
          hasAgentHistory={hasAgentHistory}
          iterating={iterating}
          key={turn.key}
          lead={lead}
          onActivateVersion={onActivateVersion}
          onEditComment={onEditComment}
          onEditingEntryKeyChange={onEditingEntryKeyChange}
          onEditReply={onEditReply}
          onFixModelChange={onFixModelChange}
          onRemoveVersion={onRemoveVersion}
          onResetInlineFlows={onResetInlineFlows}
          onThumbClick={onThumbClick}
          turn={turn}
          versionDeleting={versionDeleting}
          versionSwitching={versionSwitching}
        />
      ))}

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

      {iterationsLoading && !iterating && mayHaveFixVersions ? (
        <VariantsLoadingEntry skeletonCount={2} />
      ) : null}
    </div>
  );
}

interface TurnViewProps {
  activeVersion: number;
  /** When set, prepended as the "before" card in this turn's first run. */
  baseline?: IterationVersion;
  editingEntryKey: string | null;
  fixModel: OverlayModel;
  fixVersionCount: number;
  hasAgentHistory: boolean;
  iterating: boolean;
  lead: CommentData;
  onActivateVersion: (v: number) => Promise<void>;
  onEditComment?: (payload: TranscriptEditSubmit) => Promise<void>;
  onEditingEntryKeyChange: (key: string | null) => void;
  onEditReply?: (
    id: string,
    replyIndex: number,
    payload: TranscriptEditSubmit
  ) => Promise<void>;
  onFixModelChange: (model: OverlayModel) => void;
  onRemoveVersion: (v: number) => void | Promise<void>;
  onResetInlineFlows?: () => void;
  onThumbClick: (src: string) => void;
  turn: TranscriptTurn;
  versionDeleting: boolean;
  versionSwitching: boolean;
}

/** One turn: the instruction (comment/reply) with the runs it produced. */
function TurnView({
  turn,
  lead,
  activeVersion,
  baseline,
  hasAgentHistory,
  editingEntryKey,
  onEditingEntryKeyChange,
  fixModel,
  fixVersionCount,
  onFixModelChange,
  iterating,
  onEditComment,
  onEditReply,
  onResetInlineFlows,
  onActivateVersion,
  onRemoveVersion,
  onThumbClick,
  versionSwitching,
  versionDeleting,
}: TurnViewProps) {
  const { instruction } = turn;
  const isComment = instruction.kind === "comment";
  const author = isComment ? instruction.author : instruction.reply.author;
  const date = isComment ? instruction.date : instruction.reply.date;
  const text = isComment ? instruction.text : instruction.reply.text;
  const replyIndex =
    instruction.kind === "reply" ? instruction.replyIndex : undefined;

  let onEditSubmit:
    | ((payload: TranscriptEditSubmit) => Promise<void>)
    | undefined;
  if (isComment) {
    onEditSubmit = onEditComment;
  } else if (onEditReply && replyIndex !== undefined) {
    onEditSubmit = (payload) => onEditReply(lead.id, replyIndex, payload);
  }

  const activate = (v: number) => {
    onActivateVersion(v).catch(() => {
      // surfaced via the hook's own state
    });
  };

  return (
    <div className="space-y-4">
      <TranscriptHumanEntry
        ariaLabel={isComment ? "Edit comment" : "Edit reply"}
        author={author}
        badge={
          instruction.kind === "reply" ? (
            <ReplyVersionBadge v={instruction.reply.v} />
          ) : null
        }
        date={date}
        defaultEditMode={defaultEditModeForInstruction(
          instruction,
          hasAgentHistory
        )}
        editingEntryKey={editingEntryKey}
        entryKey={turn.key}
        fixModel={fixModel}
        fixVersionCount={fixVersionCount}
        iterating={iterating}
        onEditingEntryKeyChange={onEditingEntryKeyChange}
        onEditSubmit={onEditSubmit}
        onFixModelChange={onFixModelChange}
        onInteraction={onResetInlineFlows}
        text={text}
      />
      {turn.runs.map((run, i) => (
        <VariantGrid
          active={activeVersion}
          deleting={versionDeleting}
          key={`${turn.key}-run-${run.createdAt ?? run.versions.map((v) => v.v).join("-")}`}
          onActivate={activate}
          onRemoveVersion={onRemoveVersion}
          onThumbClick={onThumbClick}
          switching={versionSwitching}
          versions={
            i === 0 && baseline ? [baseline, ...run.versions] : run.versions
          }
        />
      ))}
    </div>
  );
}

function VariantSkeletonGrid({ count }: { count: number }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {Array.from({ length: Math.max(1, count) }, (_, i) => (
        <div
          className="redline-shimmer h-[7.5rem] rounded-lg border"
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton
          key={i}
        />
      ))}
    </div>
  );
}

function VariantsLoadingEntry({ skeletonCount }: { skeletonCount: number }) {
  return (
    <div className="flex gap-2.5">
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-muted-foreground text-xs" role="status">
          Loading versions…
        </p>
        <VariantSkeletonGrid count={skeletonCount} />
      </div>
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
        <VariantSkeletonGrid count={count} />
      </div>
    </div>
  );
}
