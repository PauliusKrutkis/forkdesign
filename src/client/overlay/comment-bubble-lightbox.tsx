import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/button.tsx";

export function CommentBubbleLightbox({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    setPortalRoot(
      document.querySelector<HTMLElement>("[data-overlay-root]") ??
        document.body
    );
  }, []);

  useEffect(() => {
    document.body.dataset.lightbox = "open";
    return () => {
      delete document.body.dataset.lightbox;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    dialog.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.close();
    };
  }, [onClose]);

  if (typeof document === "undefined" || !portalRoot) {
    return null;
  }

  return createPortal(
    <dialog
      aria-label="Version screenshot"
      className="lightbox-backdrop"
      data-comment-overlay="true"
      ref={dialogRef}
    >
      <button
        aria-label="Close screenshot"
        className="lightbox-scrim"
        onClick={onClose}
        type="button"
      />
      <div className="lightbox-image-wrap">
        <img
          alt="Version screenshot"
          className="lightbox-image"
          height={600}
          src={src}
          width={800}
        />
      </div>
      <Button
        aria-label="Close screenshot"
        className="lightbox-close"
        onClick={onClose}
        size="icon"
        type="button"
        variant="secondary"
      >
        <X className="h-4 w-4" />
      </Button>
    </dialog>,
    portalRoot
  );
}
