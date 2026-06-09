import { ChevronDown, Loader2, MessageSquareMore } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OverlayModel } from "../settings.ts";
import type { CommentData } from "../types.ts";
import { cn } from "../ui/cn.ts";
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
import { commentMayHaveAgentVersions } from "./lib/comment-may-have-agent-versions.ts";
import type { TranscriptEditSubmit } from "./transcript-entry-composer.tsx";

/** Collapse the middle once a thread has more than this many turns. */
const COLLAPSE_THRESHOLD = 4;
/** Always-visible turns at the end (most recent exchange). */
const COLLAPSE_TAIL = 2;
const RUN_START_CLOCK_SKEW_MS = 1000;

function countPersistedRunVersions(
  versions: IterationVersion[],
  startedAt: number | null
): number {
  if (startedAt === null) {
    return 0;
  }
  const threshold = startedAt - RUN_START_CLOCK_SKEW_MS;
  return versions.filter((version) => {
    if (version.v <= 0 || !version.createdAt) {
      return false;
    }
    const createdAt = Date.parse(version.createdAt);
    return Number.isFinite(createdAt) && createdAt >= threshold;
  }).length;
}

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
  agentModel: OverlayModel;
  agentVersionCount: number;
  editingEntryKey: string | null;
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
  onAgentModelChange: (model: OverlayModel) => void;
  onEditComment?: (payload: TranscriptEditSubmit) => Promise<void>;
  onEditingEntryKeyChange: (key: string | null) => void;
  onEditReply?: (
    id: string,
    replyIndex: number,
    payload: TranscriptEditSubmit
  ) => Promise<void>;
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
  agentModel,
  agentVersionCount,
  onAgentModelChange,
  iterationsLoading = false,
}: CommentTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

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
  const mayHaveAgentVersions = commentMayHaveAgentVersions(lead);
  // The baseline rides along as the leading "before" card in the first turn
  // that produced variants, so Original sits beside the new version(s).
  const firstRunTurnKey = transcript.turns.find((t) => t.runs.length > 0)?.key;

  // Collapse the middle of long threads so the lead comment + the most recent
  // exchange stay in view no matter how many replies pile up. The composer
  // never gets pushed off; reply count stops driving the panel height. Any
  // in-progress inline edit forces the full thread open so the edited entry
  // can't be hidden out from under the user.
  const collapsed =
    turnCount > COLLAPSE_THRESHOLD + 1 && !historyOpen && !editingEntryKey;
  const hiddenCount = turnCount - 1 - COLLAPSE_TAIL;
  const leadTurn = transcript.turns[0];
  const middleTurns = collapsed
    ? []
    : transcript.turns.slice(1, turnCount - COLLAPSE_TAIL);
  const tailTurns =
    turnCount > COLLAPSE_TAIL + 1
      ? transcript.turns.slice(turnCount - COLLAPSE_TAIL)
      : transcript.turns.slice(1);
  const showHistoryToggle = turnCount > COLLAPSE_THRESHOLD + 1;
  const persistedRunVersions = countPersistedRunVersions(
    iterations?.versions ?? [],
    iterateStartedAt
  );
  const pendingAgentVersionCount = Math.max(
    0,
    agentVersionCount - persistedRunVersions
  );

  const renderTurn = (turn: TranscriptTurn) => (
    <TurnView
      activeVersion={activeVersion}
      agentModel={agentModel}
      agentVersionCount={agentVersionCount}
      baseline={turn.key === firstRunTurnKey ? transcript.baseline : undefined}
      editingEntryKey={editingEntryKey}
      hasAgentHistory={hasAgentHistory}
      iterating={iterating}
      key={turn.key}
      lead={lead}
      onActivateVersion={onActivateVersion}
      onAgentModelChange={onAgentModelChange}
      onEditComment={onEditComment}
      onEditingEntryKeyChange={onEditingEntryKeyChange}
      onEditReply={onEditReply}
      onRemoveVersion={onRemoveVersion}
      onResetInlineFlows={onResetInlineFlows}
      onThumbClick={onThumbClick}
      turn={turn}
      versionDeleting={versionDeleting}
      versionSwitching={versionSwitching}
    />
  );

  // Stick to the bottom as the conversation grows / an agent run streams in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on growth/stream
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [turnCount, iterating, iterationsLoading, editingEntryKey, historyOpen]);

  return (
    <div
      className="scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5"
      ref={scrollRef}
    >
      {leadTurn ? renderTurn(leadTurn) : null}

      {showHistoryToggle ? (
        <HistoryToggle
          hiddenCount={hiddenCount}
          onToggle={() => setHistoryOpen((v) => !v)}
          open={!collapsed}
        />
      ) : null}

      {middleTurns.map(renderTurn)}

      {tailTurns.map(renderTurn)}

      {versionDeleteError ? (
        <p className="m-0 text-destructive text-xs" role="alert">
          {versionDeleteError}
        </p>
      ) : null}

      {iterating ? (
        <ThinkingEntry
          count={pendingAgentVersionCount}
          iterateNow={iterateNow}
          iterateStartedAt={iterateStartedAt}
          status={iterateStatus}
        />
      ) : null}

      {iterationsLoading && !iterating && mayHaveAgentVersions ? (
        <VariantsLoadingEntry skeletonCount={2} />
      ) : null}
    </div>
  );
}

interface TurnViewProps {
  activeVersion: number;
  agentModel: OverlayModel;
  agentVersionCount: number;
  /** When set, prepended as the "before" card in this turn's first run. */
  baseline?: IterationVersion;
  editingEntryKey: string | null;
  hasAgentHistory: boolean;
  iterating: boolean;
  lead: CommentData;
  onActivateVersion: (v: number) => Promise<void>;
  onAgentModelChange: (model: OverlayModel) => void;
  onEditComment?: (payload: TranscriptEditSubmit) => Promise<void>;
  onEditingEntryKeyChange: (key: string | null) => void;
  onEditReply?: (
    id: string,
    replyIndex: number,
    payload: TranscriptEditSubmit
  ) => Promise<void>;
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
  agentModel,
  agentVersionCount,
  onAgentModelChange,
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
        agentModel={agentModel}
        agentVersionCount={agentVersionCount}
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
        iterating={iterating}
        onAgentModelChange={onAgentModelChange}
        onEditingEntryKeyChange={onEditingEntryKeyChange}
        onEditSubmit={onEditSubmit}
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

/**
 * Expander that hides the middle of a long thread. Collapsed, it reads as
 * "N earlier replies"; open, it offers to hide them again. The lead comment
 * and the most recent turns stay visible on either side of it.
 */
function HistoryToggle({
  hiddenCount,
  open,
  onToggle,
}: {
  hiddenCount: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={open}
      className="flex w-full items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-left text-muted-foreground text-xs transition-colors hover:border-border hover:bg-muted/60"
      onClick={onToggle}
      type="button"
    >
      <MessageSquareMore aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">
        {open
          ? `Hide ${hiddenCount} earlier ${hiddenCount === 1 ? "reply" : "replies"}`
          : `${hiddenCount} earlier ${hiddenCount === 1 ? "reply" : "replies"}`}
      </span>
      <ChevronDown
        aria-hidden
        className={cn(
          "chevron h-4 w-4 shrink-0",
          open && "chevron-open"
        )}
      />
    </button>
  );
}

function VariantSkeletonGrid({ count }: { count: number }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {Array.from({ length: Math.max(1, count) }, (_, i) => (
        <div
          className="shimmer h-[7.5rem] rounded-lg border"
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
        {count > 0 ? <VariantSkeletonGrid count={count} /> : null}
      </div>
    </div>
  );
}
