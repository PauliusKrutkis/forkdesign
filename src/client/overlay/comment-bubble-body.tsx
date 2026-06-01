import type { CommentData } from "../types.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { ModeToggleButton } from "./comment-bubble-action-buttons.tsx";
import { CommentBubbleAttribution } from "./comment-bubble-attribution.tsx";
import { CommentBubbleReplyItem } from "./comment-bubble-reply-item.tsx";
import { AdaptiveThumb } from "./comment-thumb.tsx";
import {
  CommentVersionHistory,
  formatVersionDisplay,
  shouldShowVersionHistory,
} from "./comment-version-history.tsx";
import { CommentVersionPicker } from "./comment-version-picker.tsx";
import type { BubbleMode } from "./hooks/use-iterate-fix.ts";
import type { IterationsData } from "./hooks/use-iterations.ts";
import { HotkeyTip } from "./hotkey-tip.tsx";
import { InlineCommentEditor } from "./inline-comment-editor.tsx";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";

export interface CommentBubbleBodyProps {
  cancelEditing: () => void;
  cancelReply: () => void;
  comments: CommentData[];
  editBusy: boolean;
  editDraft: string;
  editError: string | null;
  editing: boolean;
  editTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  iterating: boolean;
  iterations: IterationsData | null;
  lead: CommentData;
  mode: BubbleMode;
  multiVersion: boolean;
  onActivateVersion: (v: number) => Promise<void>;
  onDeleteReply?: (id: string, replyIndex: number) => Promise<void>;
  onEdit?: (id: string, text: string) => Promise<void>;
  onEditDraftChange: (value: string) => void;
  onEditReply?: (id: string, replyIndex: number, text: string) => Promise<void>;
  onRemoveVersion: (v: number) => void | Promise<void>;
  onReplyDraftChange: (value: string) => void;
  onResetInlineFlows: () => void;
  onSaveEdit: () => void | Promise<void>;
  onSaveReply: () => void | Promise<void>;
  onSetLightboxSrc: (src: string | null) => void;
  onStartEditing: () => void;
  onToggleMode: () => void;
  replyBusy: boolean;
  replyDraft: string;
  replyError: string | null;
  replyOpen: boolean;
  replyTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  skipDeleteConfirmation: boolean;
  versionDeleteError: string | null;
  versionDeleting: boolean;
  versionSwitching: boolean;
}

function CommentBubbleExtraComments({ comments }: { comments: CommentData[] }) {
  if (comments.length <= 1) {
    return null;
  }
  return (
    <ul className="m-0 mt-3 list-none space-y-2.5 border-t p-0 pt-3">
      {comments.slice(1).map((extra) => (
        <li key={extra.id}>
          <p className="m-0 text-muted-foreground text-sm leading-snug">
            {extra.text}
          </p>
          <CommentBubbleAttribution
            author={extra.author}
            className="mt-1"
            date={extra.date}
          />
        </li>
      ))}
    </ul>
  );
}

function CommentBubbleReplyLists({
  lead,
  mode,
  iterations,
  onDeleteReply,
  onEditReply,
  onResetInlineFlows,
  skipDeleteConfirmation,
}: Pick<
  CommentBubbleBodyProps,
  | "lead"
  | "mode"
  | "iterations"
  | "onDeleteReply"
  | "onEditReply"
  | "onResetInlineFlows"
  | "skipDeleteConfirmation"
>) {
  if (mode !== "detailed" || !iterations) {
    return null;
  }
  if (shouldShowVersionHistory(iterations)) {
    return null;
  }
  if (!lead.replies || lead.replies.length === 0) {
    return null;
  }
  return (
    <ul className="m-0 mt-3 list-none space-y-2.5 border-t p-0 pt-3">
      {[...lead.replies.entries()].reverse().map(([i, reply]) => (
        <CommentBubbleReplyItem
          commentId={lead.id}
          key={`${reply.author}-${reply.date}-${i}`}
          onDelete={onDeleteReply}
          onEdit={onEditReply}
          onInteraction={onResetInlineFlows}
          reply={reply}
          replyIndex={i}
          skipDeleteConfirmation={skipDeleteConfirmation}
        />
      ))}
    </ul>
  );
}

export function CommentBubbleBody({
  lead,
  comments,
  mode,
  editing,
  iterations,
  iterating,
  multiVersion,
  editBusy,
  editDraft,
  editError,
  editTextareaRef,
  cancelEditing,
  onSaveEdit,
  onEditDraftChange,
  onEdit,
  onStartEditing,
  onToggleMode,
  onActivateVersion,
  onSetLightboxSrc,
  versionDeleting,
  versionSwitching,
  onDeleteReply,
  onEditReply,
  onResetInlineFlows,
  onRemoveVersion,
  versionDeleteError,
  replyOpen,
  replyBusy,
  replyDraft,
  replyError,
  replyTextareaRef,
  cancelReply,
  onSaveReply,
  onReplyDraftChange,
  skipDeleteConfirmation,
}: CommentBubbleBodyProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-3">
      <div className="flex items-start gap-3">
        {editing ? (
          <div className="min-w-0 flex-1">
            <InlineCommentEditor
              ariaLabel="Edit comment"
              busy={editBusy}
              error={editError}
              minHeightClass="min-h-[72px]"
              onCancel={cancelEditing}
              onChange={onEditDraftChange}
              onSave={onSaveEdit}
              textareaRef={editTextareaRef}
              value={editDraft}
            />
          </div>
        ) : (
          <p
            className={cn(
              "m-0 min-w-0 flex-1 whitespace-pre-wrap text-foreground text-sm leading-relaxed",
              mode === "compact" && "line-clamp-3"
            )}
          >
            {lead.text}
          </p>
        )}
        {mode === "detailed" &&
        !editing &&
        iterations &&
        shouldShowVersionHistory(iterations) ? (
          <CommentVersionPicker
            data={iterations}
            disabled={iterating || versionDeleting}
            onActivate={(v) => {
              onActivateVersion(v).catch(ignorePromiseRejection);
            }}
            switching={versionSwitching || versionDeleting}
          />
        ) : null}
        {mode === "detailed" && !editing && lead.screenshot && !multiVersion ? (
          <AdaptiveThumb
            onClick={() => onSetLightboxSrc(lead.screenshot ?? null)}
            src={lead.screenshot}
          />
        ) : null}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <CommentBubbleAttribution author={lead.author} date={lead.date} />
        <div className="flex shrink-0 items-center gap-0.5">
          {onEdit && !editing ? (
            <HotkeyTip keys="E" label="Edit">
              <Button
                className="h-auto px-1.5 py-1 text-xs"
                onClick={onStartEditing}
                size="sm"
                type="button"
                variant="ghost"
              >
                Edit
              </Button>
            </HotkeyTip>
          ) : null}
          <ModeToggleButton mode={mode} onToggle={onToggleMode} />
        </div>
      </div>

      {mode === "detailed" ? (
        <CommentBubbleExtraComments comments={comments} />
      ) : null}

      {mode === "detailed" &&
      iterations &&
      shouldShowVersionHistory(iterations) ? (
        <CommentVersionHistory
          active={iterations.active}
          deleteError={versionDeleteError}
          disabled={iterating || versionDeleting}
          onActivate={(v) => {
            onActivateVersion(v).catch(ignorePromiseRejection);
          }}
          onDeleteVersion={(v) => Promise.resolve(onRemoveVersion(v))}
          onThumbClick={onSetLightboxSrc}
          renderReply={(reply, i) => (
            <CommentBubbleReplyItem
              commentId={lead.id}
              onDelete={onDeleteReply}
              onEdit={onEditReply}
              onInteraction={onResetInlineFlows}
              reply={reply}
              replyIndex={i}
              skipDeleteConfirmation={skipDeleteConfirmation}
            />
          )}
          replies={lead.replies}
          switching={versionSwitching || versionDeleting}
          versions={iterations.versions}
        />
      ) : null}

      <CommentBubbleReplyLists
        iterations={iterations}
        lead={lead}
        mode={mode}
        onDeleteReply={onDeleteReply}
        onEditReply={onEditReply}
        onResetInlineFlows={onResetInlineFlows}
        skipDeleteConfirmation={skipDeleteConfirmation}
      />

      {mode === "detailed" && replyOpen ? (
        <div className="mt-3 space-y-2 border-t pt-3">
          {iterations && shouldShowVersionHistory(iterations) ? (
            <p className="m-0 text-muted-foreground text-xs">
              Replying on {formatVersionDisplay(iterations.active)}
            </p>
          ) : null}
          <InlineCommentEditor
            ariaLabel="Reply"
            busy={replyBusy}
            error={replyError}
            onCancel={cancelReply}
            onChange={onReplyDraftChange}
            onSave={onSaveReply}
            placeholder="Write a reply…"
            saveLabel="Save reply"
            textareaRef={replyTextareaRef}
            value={replyDraft}
          />
        </div>
      ) : null}
    </div>
  );
}
