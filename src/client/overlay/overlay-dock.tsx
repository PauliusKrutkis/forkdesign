import { useEffect, useRef, useState } from "react";
import { type OverlayPosition, POSITION_CLASSES } from "../settings.ts";
import { cn } from "../ui/cn.ts";
import type { ShellTab } from "./comment-shell.tsx";
import { useDismissOnOutside } from "./hooks/use-dismiss-on-outside.ts";
import { OverlayDockMenu, OverlayDockPill } from "./overlay-dock-menu.tsx";

export interface OverlayDockProps {
  /**
   * Drop the dock beneath an open comment bubble (z-9195 instead of z-9400) so
   * a bubble that floats over the dock's corner can receive clicks on its own
   * controls. The pill stays above page anchors/pins, so it remains clickable
   * wherever the bubble doesn't overlap it.
   */
  belowBubble: boolean;
  composerActive: boolean;
  enabled: boolean;
  onPageCount: number;
  onToggleComposer: () => void;
  onToggleEnabled: () => void;
  onToggleList: () => void;
  onToggleSettings: () => void;
  position: OverlayPosition;
  shell: ShellTab | null;
  show: boolean;
  totalCount: number;
}

export function OverlayDock({
  show,
  position,
  belowBubble,
  enabled,
  onToggleEnabled,
  composerActive,
  onToggleComposer,
  shell,
  onToggleList,
  onToggleSettings,
  totalCount,
  onPageCount,
}: OverlayDockProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useDismissOnOutside({
    active: open,
    onDismiss: () => setOpen(false),
    rootRef,
  });

  useEffect(() => {
    if (shell || composerActive) {
      setOpen(false);
    }
  }, [shell, composerActive]);

  if (!show) {
    return null;
  }

  const openUp = position.startsWith("bottom");
  const alignEnd = position.endsWith("right");

  const pill = (
    <OverlayDockPill
      enabled={enabled}
      onToggle={() => setOpen((v) => !v)}
      open={open}
      totalCount={totalCount}
    />
  );

  const menu = open ? (
    <OverlayDockMenu
      alignEnd={alignEnd}
      composerActive={composerActive}
      enabled={enabled}
      onClose={() => setOpen(false)}
      onPageCount={onPageCount}
      onToggleComposer={onToggleComposer}
      onToggleEnabled={onToggleEnabled}
      onToggleList={onToggleList}
      onToggleSettings={onToggleSettings}
      openUp={openUp}
      shell={shell}
      totalCount={totalCount}
    />
  ) : null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed flex flex-col gap-2",
        belowBubble ? "z-[9195]" : "z-[9400]",
        POSITION_CLASSES[position]
      )}
      data-comment-overlay="true"
      data-dock="true"
      ref={rootRef}
    >
      {openUp ? (
        <>
          {menu}
          {pill}
        </>
      ) : (
        <>
          {pill}
          {menu}
        </>
      )}
    </div>
  );
}
