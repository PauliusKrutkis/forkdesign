import { Check, History, Sparkles, Trash2 } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { DeleteConfirmOverlay } from "./delete-confirm-overlay.tsx";
import { useDeleteConfirm } from "./hooks/use-delete-confirm.ts";
import type { IterationVersion } from "./hooks/use-iterations.ts";
import { formatDate } from "./lib/bubble-formatters.ts";
import { formatVersionDisplay } from "./lib/version-format.ts";

interface CommentVariantGroupProps {
  active: number;
  createdAt?: string;
  deleting: boolean;
  isBaseline: boolean;
  onActivate: (v: number) => void;
  onRemoveVersion: (v: number) => void | Promise<void>;
  onThumbClick: (src: string) => void;
  switching: boolean;
  versions: IterationVersion[];
}

function AgentAvatar({ baseline }: { baseline: boolean }) {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground"
    >
      {baseline ? (
        <History className="h-3.5 w-3.5" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
    </span>
  );
}

/**
 * One agent run rendered as a chat turn: a header line plus the versions it
 * produced as a grid of cards. The baseline (`v0`) is its own group so the
 * user can always see — and revert to — where they started.
 */
export function CommentVariantGroup({
  versions,
  isBaseline,
  createdAt,
  active,
  switching,
  deleting,
  onActivate,
  onRemoveVersion,
  onThumbClick,
}: CommentVariantGroupProps) {
  const count = versions.length;
  const heading = (() => {
    if (isBaseline) {
      return "Baseline";
    }
    return count > 1 ? `${count} variants` : "Fix";
  })();

  return (
    <div className="flex gap-2.5">
      <AgentAvatar baseline={isBaseline} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-foreground text-xs">{heading}</span>
          {createdAt ? (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {formatDate(createdAt)}
            </span>
          ) : null}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {versions.map((version) => (
            <VariantCard
              active={active}
              deleting={deleting}
              key={version.v}
              onActivate={onActivate}
              onRemoveVersion={onRemoveVersion}
              onThumbClick={onThumbClick}
              switching={switching}
              version={version}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function VariantCard({
  version,
  active,
  switching,
  deleting,
  onActivate,
  onRemoveVersion,
  onThumbClick,
}: {
  version: IterationVersion;
  active: number;
  switching: boolean;
  deleting: boolean;
  onActivate: (v: number) => void;
  onRemoveVersion: (v: number) => void | Promise<void>;
  onThumbClick: (src: string) => void;
}) {
  const isActive = version.v === active;
  const canDelete = version.v > 0;
  const label = version.v === 0 ? "Baseline" : formatVersionDisplay(version.v);

  const {
    confirming,
    busy: deleteBusy,
    requestDelete,
    confirmDelete,
    cancelDelete,
  } = useDeleteConfirm({
    onDelete: async () => {
      await onRemoveVersion(version.v);
    },
  });

  return (
    <div
      className={cn(
        "group/card relative overflow-hidden rounded-lg border bg-background transition-shadow",
        isActive ? "border-primary ring-1 ring-primary" : "hover:border-ring/60"
      )}
    >
      <button
        aria-label="Show full screenshot"
        className="block h-20 w-full bg-muted"
        onClick={() => onThumbClick(version.png)}
        type="button"
      >
        <img
          alt=""
          className="h-full w-full object-contain"
          height={80}
          src={version.png}
          width={320}
        />
      </button>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <span className="truncate font-mono text-[10px] text-muted-foreground tabular-nums">
          {label}
        </span>
        {isActive ? (
          <span className="flex shrink-0 items-center gap-1 font-medium text-[10px] text-primary">
            <Check aria-hidden className="h-3 w-3" />
            Live
          </span>
        ) : (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              className="h-6 px-1.5 text-[11px]"
              disabled={switching || deleting}
              onClick={() => onActivate(version.v)}
              size="sm"
              type="button"
              variant="outline"
            >
              {switching ? "…" : "Use"}
            </Button>
            {canDelete ? (
              <Button
                aria-label="Delete version"
                className="h-6 w-6 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/card:opacity-100"
                disabled={deleting || deleteBusy}
                onClick={requestDelete}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        )}
      </div>
      {confirming ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/95 p-2 text-center">
          <span className="font-medium text-foreground text-xs">
            Delete {label}?
          </span>
          <DeleteConfirmOverlay
            busy={deleteBusy}
            layout="inline"
            onCancel={cancelDelete}
            onConfirm={confirmDelete}
          />
        </div>
      ) : null}
    </div>
  );
}
