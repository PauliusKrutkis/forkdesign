/** NDJSON event shapes streamed from `POST /api/iterations/new`. */
export interface IterateProgressEvent {
  detail?: string;
  stage?: "agent" | "snapshot";
  tool?: string;
  type: "progress";
}

export type IterateDoneEvent =
  | {
      type: "done";
      ok: true;
      id?: string;
      changed?: boolean;
      v?: number;
      versions?: number[];
      tsx?: string;
      png?: string;
      modelUsed?: string;
      durationMs?: number;
      turnsUsed?: number;
      toolCalls?: number;
    }
  | { type: "done"; ok: false; error?: string };

export type IterateStreamEvent = IterateProgressEvent | IterateDoneEvent;

export function readViewport(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: 1024, height: 768 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

export function formatProgress(event: IterateProgressEvent): string {
  const { tool, detail } = event;
  if (tool && detail) {
    return `${tool} ${detail}`;
  }
  if (tool) {
    return tool;
  }
  if (detail) {
    return detail;
  }
  return "Working...";
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return iso;
  }
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
