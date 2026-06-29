import { Check, Expand, Sparkles, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { DeleteConfirmOverlay } from "./delete-confirm-overlay.tsx";
import { useDeleteConfirm } from "./hooks/use-delete-confirm.ts";
import type { IterationVersion } from "./hooks/use-iterations.ts";
import { formatVersionDisplay } from "./lib/version-format.ts";

interface VariantGridProps {
  active: number;
  deleting: boolean;
  onActivate: (v: number) => void;
  onRemoveVersion: (v: number) => void | Promise<void>;
  onThumbClick: (src: string) => void;
  runActive: boolean;
  switching: boolean;
  versions: IterationVersion[];
}

function VariantFooterStatus({
  showLive,
  showSwitching,
}: {
  showLive: boolean;
  showSwitching: boolean;
}): ReactNode {
  if (showLive) {
    return (
      <span className="flex items-center gap-1 font-medium text-[10px] text-primary leading-none">
        <Check aria-hidden className="h-3 w-3 shrink-0" />
        Live
      </span>
    );
  }
  if (showSwitching) {
    return (
      <span className="font-mono text-[10px] text-muted-foreground leading-none">
        …
      </span>
    );
  }
  return <span aria-hidden className="h-6 w-6" />;
}

function PendingVariantThumbnail() {
  // Screenshots are lazy: the variant exists but its thumbnail is captured only
  // when the user previews it (or the run applies it as the winner). So this is
  // a ready state, not a busy one — no spinner, and copy that says as much.
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground">
      <Sparkles aria-hidden className="h-4 w-4" />
      <span className="font-mono text-[10px] leading-none">
        New version ready
      </span>
    </div>
  );
}

function VariantThumbnail({ src }: { src: string }) {
  const [ready, setReady] = useState(false);

  return (
    <>
      {ready ? null : <div aria-hidden className="shimmer absolute inset-0" />}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: track decode for skeleton */}
      <img
        alt=""
        className={cn(
          "h-full w-full object-contain transition-opacity",
          ready ? "opacity-100" : "opacity-0"
        )}
        height={80}
        onLoad={() => setReady(true)}
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0) {
            setReady(true);
          }
        }}
        src={src}
        width={320}
      />
    </>
  );
}

/**
 * The variant cards produced by one agent run, as a 2-up grid. Rendered inside
 * a turn (beneath the instruction that produced it), so it carries no avatar or
 * heading of its own. Clicking a card makes that version live; the expand
 * button opens the full screenshot; non-baseline versions can be deleted.
 */
export function VariantGrid({
  versions,
  active,
  switching,
  deleting,
  runActive,
  onActivate,
  onRemoveVersion,
  onThumbClick,
}: VariantGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {versions.map((version) => (
        <VariantCard
          active={active}
          deleting={deleting}
          key={version.v}
          onActivate={onActivate}
          onRemoveVersion={onRemoveVersion}
          onThumbClick={onThumbClick}
          runActive={runActive}
          switching={switching}
          version={version}
        />
      ))}
    </div>
  );
}

function VariantCard({
  version,
  active,
  switching,
  deleting,
  runActive,
  onActivate,
  onRemoveVersion,
  onThumbClick,
}: {
  version: IterationVersion;
  active: number;
  switching: boolean;
  deleting: boolean;
  runActive: boolean;
  onActivate: (v: number) => void;
  onRemoveVersion: (v: number) => void | Promise<void>;
  onThumbClick: (src: string) => void;
}) {
  const isActive = version.v === active;
  const showLive = isActive;
  const screenshotPending = Boolean(version.screenshotPending);
  const canDelete = version.v > 0;
  const label = version.v === 0 ? "Original" : formatVersionDisplay(version.v);

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

  const canActivate = !(isActive || switching || deleting || confirming);

  const activate = () => {
    if (!canActivate) {
      return;
    }
    onActivate(version.v);
  };

  const footerTrailing = (
    <VariantFooterStatus
      showLive={showLive}
      showSwitching={switching && isActive}
    />
  );

  const cardBody = (
    <>
      <div className="relative h-20 w-full bg-muted">
        {screenshotPending ? (
          <PendingVariantThumbnail />
        ) : (
          <VariantThumbnail key={version.png} src={version.png} />
        )}
      </div>
      <div className="flex h-7 items-center justify-between gap-1 px-2">
        <span className="truncate font-mono text-[10px] text-muted-foreground tabular-nums leading-none">
          {label}
        </span>
        <div className="flex h-6 min-w-6 shrink-0 items-center justify-end">
          {footerTrailing}
        </div>
      </div>
    </>
  );

  return (
    <div
      className={cn(
        "group/card relative overflow-hidden rounded-lg border bg-background transition-shadow",
        showLive && "border-primary ring-1 ring-primary",
        !showLive && "hover:border-ring/60"
      )}
    >
      {canActivate ? (
        <button
          aria-label={`Use ${label}`}
          className="block w-full cursor-pointer text-left"
          onClick={activate}
          type="button"
        >
          {cardBody}
        </button>
      ) : (
        cardBody
      )}
      {screenshotPending ? null : (
        <Button
          aria-label="View screenshot fullscreen"
          className="absolute top-1 right-1 z-10 h-6 w-6 bg-background/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100"
          onClick={() => onThumbClick(version.png)}
          size="icon"
          type="button"
          variant="secondary"
        >
          <Expand aria-hidden className="h-3.5 w-3.5" />
        </Button>
      )}
      {canDelete && !isActive ? (
        <Button
          aria-label="Delete version"
          className="absolute right-1 bottom-0.5 z-10 h-6 w-6 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/card:opacity-100"
          disabled={deleting || deleteBusy || confirming || runActive}
          onClick={(e) => {
            e.stopPropagation();
            requestDelete();
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {confirming ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 bg-background/95 p-2.5 text-center backdrop-blur-[2px]">
          <span className="font-medium font-mono text-[11px] text-foreground tracking-tight">
            Delete {label}?
          </span>
          <DeleteConfirmOverlay
            busy={deleteBusy}
            layout="compact"
            onCancel={cancelDelete}
            onConfirm={confirmDelete}
          />
        </div>
      ) : null}
    </div>
  );
}
