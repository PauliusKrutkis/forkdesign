import { useMemo, useState } from "react";

/**
 * Adaptive screenshot thumbnail. See CommentBubble for sizing rules.
 */
export function AdaptiveThumb({
  src,
  onClick,
  className,
}: {
  src: string;
  onClick?: () => void;
  className?: string;
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const dims = useMemo(() => computeThumbDims(natural), [natural]);

  const inner = (
    <img
      alt=""
      className="h-full w-full object-contain"
      key={src}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        }
      }}
      src={src}
    />
  );

  const style = { width: dims.width, height: dims.height };
  const baseClass =
    "block shrink-0 overflow-hidden rounded-md border bg-muted transition-shadow hover:ring-1 hover:ring-ring";

  if (onClick) {
    return (
      <button
        aria-label="Show full screenshot"
        className={[baseClass, className].filter(Boolean).join(" ")}
        onClick={onClick}
        style={style}
        type="button"
      >
        {inner}
      </button>
    );
  }

  return (
    <span
      className={[baseClass, className].filter(Boolean).join(" ")}
      style={style}
    >
      {inner}
    </span>
  );
}

export function MicroThumb({ src }: { src: string }) {
  return (
    <span className="block h-8 w-8 shrink-0 overflow-hidden rounded border bg-muted">
      <img alt="" className="h-full w-full object-contain" key={src} src={src} />
    </span>
  );
}

export function computeThumbDims(natural: { w: number; h: number } | null): {
  width: number;
  height: number;
} {
  if (!natural) {
    return { width: 36, height: 36 };
  }
  const { w, h } = natural;
  if (w < 40 || h < 40) {
    return { width: 24, height: 24 };
  }
  const aspect = w / h;
  if (aspect > 1.3) {
    const width = 80;
    const height = Math.max(24, Math.min(48, Math.round(width / aspect)));
    return { width, height };
  }
  if (aspect < 0.7) {
    const width = 36;
    const height = Math.max(60, Math.min(80, Math.round(width / aspect)));
    return { width, height };
  }
  return { width: 36, height: 36 };
}
