import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

interface CommentVersionSwitcherProps {
  commentId: string;
}

interface IterationVersion {
  png: string;
  tsx: string;
  v: number;
}

interface IterationsResponse {
  active: number;
  file: string;
  id: string;
  versions: IterationVersion[];
}

export function CommentVersionSwitcher({
  commentId,
}: CommentVersionSwitcherProps) {
  const [data, setData] = useState<IterationsResponse | null>(null);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/iterations?id=${encodeURIComponent(commentId)}`
      );
      if (!res.ok) {
        setData(null);
        return;
      }
      const body = (await res.json()) as IterationsResponse;
      setData(body);
    } catch {
      setData(null);
    }
  }, [commentId]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await load();
      if (cancelled) {
        return;
      }
    };
    void run();

    if (import.meta.hot) {
      const handler = () => void load();
      import.meta.hot.on("vite:afterUpdate", handler);
      return () => {
        cancelled = true;
        import.meta.hot?.off("vite:afterUpdate", handler);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [load]);

  const activate = useCallback(
    async (v: number) => {
      if (switching) {
        return;
      }
      setSwitching(true);
      try {
        const res = await fetch("/api/iterations/activate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: commentId, v }),
        });
        if (!res.ok) {
          setSwitching(false);
          return;
        }
        setData((prev) => (prev ? { ...prev, active: v } : prev));
      } catch {
        setSwitching(false);
      }
    },
    [commentId, switching]
  );

  useEffect(() => {
    if (switching && data) {
      setSwitching(false);
    }
  }, [data, switching]);

  useEffect(() => {
    if (!data || data.versions.length <= 1) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const active = document.activeElement;
      const inInput =
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active instanceof HTMLElement && active.isContentEditable));
      if (inInput) {
        return;
      }
      if (e.key === "ArrowLeft" && data.active > 0 && !switching) {
        e.preventDefault();
        void activate(data.active - 1);
      } else if (
        e.key === "ArrowRight" &&
        data.active < data.versions.length - 1 &&
        !switching
      ) {
        e.preventDefault();
        void activate(data.active + 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data, switching, activate]);

  if (!data) {
    return null;
  }
  const total = data.versions.length;
  if (total <= 0) {
    return null;
  }

  const active = data.active;
  const display = active + 1;

  if (total === 1) {
    return (
      <span className="inline-flex h-7 items-center px-2 font-mono text-muted-foreground text-xs tabular-nums">
        v{display}
      </span>
    );
  }

  const canPrev = !switching && active > 0;
  const canNext = !switching && active < total - 1;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 font-mono text-muted-foreground text-xs",
        switching && "opacity-60"
      )}
    >
      <Button
        aria-label="Previous version"
        className="h-7 w-7"
        disabled={!canPrev}
        onClick={() => void activate(active - 1)}
        size="icon"
        title="Previous version (←)"
        type="button"
        variant="outline"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span className="min-w-[72px] px-1 text-center tabular-nums">
        v{display} of {total}
      </span>
      <Button
        aria-label="Next version"
        className="h-7 w-7"
        disabled={!canNext}
        onClick={() => void activate(active + 1)}
        size="icon"
        title="Next version (→)"
        type="button"
        variant="outline"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
