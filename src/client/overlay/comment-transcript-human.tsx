import type { ReactNode } from "react";
import type { OverlayModel } from "../settings.ts";
import { cn } from "../ui/cn.ts";
import { CommentBubbleAttribution } from "./comment-bubble-attribution.tsx";
import type { ComposerMode } from "./comment-composer-bar.tsx";
import {
  type TranscriptEditSubmit,
  TranscriptEntryComposer,
} from "./transcript-entry-composer.tsx";

const NAME_SEPARATOR = /[.\-_\s]+/;

/** Initials for the entry avatar, derived from an author identifier/email. */
function initials(author: string): string {
  const name = author.split("@")[0] ?? author;
  const parts = name.split(NAME_SEPARATOR).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function HumanAvatar({ author }: { author: string }) {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full bg-primary font-medium text-[10px] text-primary-foreground"
      title={author}
    >
      {initials(author)}
    </span>
  );
}

const entrySurfaceClass =
  "block w-full rounded-lg border border-transparent px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow] duration-150 ease-out";

const entryInteractiveClass = cn(
  entrySurfaceClass,
  "cursor-pointer text-foreground",
  "hover:border-border/70 hover:bg-muted/50 hover:shadow-[0_1px_0_rgb(0_0_0/0.03)]",
  "active:bg-muted/65",
  "focus-visible:border-ring/40 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
);

interface TranscriptHumanEntryProps {
  agentModel: OverlayModel;
  agentVersionCount: number;
  ariaLabel: string;
  author: string;
  /** Optional badge shown in the meta row (e.g. `Re: v2` for replies). */
  badge?: ReactNode;
  date: string;
  defaultEditMode: ComposerMode;
  editingEntryKey: string | null;
  entryKey: string;
  iterating: boolean;
  onAgentModelChange: (model: OverlayModel) => void;
  onEditingEntryKeyChange: (key: string | null) => void;
  onEditSubmit?: (payload: TranscriptEditSubmit) => Promise<void>;
  onInteraction?: () => void;
  text: string;
}

function HumanEntryBody({
  text,
  badge,
  author,
  date,
}: {
  text: string;
  badge?: ReactNode;
  author: string;
  date: string;
}) {
  return (
    <>
      <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
        {badge}
        <CommentBubbleAttribution author={author} date={date} />
      </div>
    </>
  );
}

/**
 * One human turn in the transcript — the original comment or a reply. Click the
 * whole message block to edit with the same composer UI as the bubble footer;
 * agent mode re-runs the agent after persisting the updated text.
 */
export function TranscriptHumanEntry({
  text,
  author,
  date,
  badge,
  ariaLabel,
  entryKey,
  editingEntryKey,
  onEditingEntryKeyChange,
  defaultEditMode,
  agentModel,
  agentVersionCount,
  onAgentModelChange,
  iterating,
  onEditSubmit,
  onInteraction,
}: TranscriptHumanEntryProps) {
  const editing = editingEntryKey === entryKey;
  const canEdit = Boolean(onEditSubmit);

  const startEditing = () => {
    if (!canEdit || iterating) {
      return;
    }
    onInteraction?.();
    onEditingEntryKeyChange(entryKey);
  };

  const endEditing = () => {
    onEditingEntryKeyChange(null);
  };

  let body: ReactNode;
  if (editing && onEditSubmit) {
    body = (
      <TranscriptEntryComposer
        agentModel={agentModel}
        agentVersionCount={agentVersionCount}
        defaultMode={defaultEditMode}
        disabled={false}
        initialText={text}
        iterating={iterating}
        onAgentModelChange={onAgentModelChange}
        onCancel={endEditing}
        onSubmit={async (payload) => {
          await onEditSubmit(payload);
          endEditing();
        }}
      />
    );
  } else if (canEdit) {
    body = (
      <button
        aria-label={ariaLabel}
        className={cn(
          entryInteractiveClass,
          "-mx-2.5",
          iterating &&
            "cursor-not-allowed opacity-60 hover:border-transparent hover:bg-transparent hover:shadow-none"
        )}
        disabled={iterating}
        onClick={startEditing}
        type="button"
      >
        <HumanEntryBody author={author} badge={badge} date={date} text={text} />
      </button>
    );
  } else {
    body = (
      <div className={cn(entrySurfaceClass, "-mx-2.5")}>
        <HumanEntryBody author={author} badge={badge} date={date} text={text} />
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <HumanAvatar author={author} />
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
}
