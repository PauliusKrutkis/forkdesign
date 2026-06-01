import { useEffect } from "react";

export function useDismissOnOutside(args: {
  active: boolean;
  onDismiss: () => void;
  rootRef: React.RefObject<HTMLElement | null>;
}): void {
  const { active, onDismiss, rootRef } = args;

  useEffect(() => {
    if (!active) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (
        rootRef.current &&
        e.target instanceof Node &&
        rootRef.current.contains(e.target)
      ) {
        return;
      }
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [active, onDismiss, rootRef]);
}
