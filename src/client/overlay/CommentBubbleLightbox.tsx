import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/button.tsx";

/** Click-to-enlarge screenshot; portaled to the overlay root for z-index. */
export function CommentBubbleLightbox({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(
      document.querySelector<HTMLElement>("[data-redline-overlay-root]") ??
        document.body
    );
  }, []);

  useEffect(() => {
    document.body.dataset.redlineLightbox = "open";
    return () => {
      delete document.body.dataset.redlineLightbox;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (typeof document === "undefined" || !portalRoot) {
    return null;
  }

  return createPortal(
    <div
      aria-label="Comment screenshot"
      className="redline-lightbox-backdrop"
      data-comment-overlay="true"
      onClick={onClose}
      role="dialog"
    >
      <img
        alt=""
        className="redline-lightbox-image"
        onClick={(e) => e.stopPropagation()}
        src={src}
      />
      <Button
        aria-label="Close screenshot"
        className="absolute top-6 right-6"
        onClick={onClose}
        size="icon"
        type="button"
        variant="secondary"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>,
    portalRoot
  );
}
