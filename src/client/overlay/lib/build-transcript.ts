import type { CommentReply } from "../../types.ts";
import type { IterationVersion } from "../hooks/use-iterations.ts";

/**
 * A single row in the comment's conversation. The bubble renders these
 * top-to-bottom (oldest first), with the persistent composer underneath:
 *
 *   - `comment`  — the original instruction (always pinned first)
 *   - `variants` — one agent run: the versions it produced, grouped together.
 *                  `v0` is the baseline (pinned right after the comment); a
 *                  fix run with `count > 1` becomes a single group of N cards.
 *   - `reply`    — a follow-up note (human comment, or the steering text that
 *                  was sent alongside a Fix), interleaved by date.
 */
export type TranscriptEntry =
  | {
      kind: "comment";
      sortKey: number;
      id: string;
      text: string;
      author: string;
      date: string;
    }
  | {
      kind: "reply";
      sortKey: number;
      reply: CommentReply;
      replyIndex: number;
    }
  | {
      kind: "variants";
      sortKey: number;
      isBaseline: boolean;
      createdAt?: string;
      versions: IterationVersion[];
    };

// Pinned positions. Real timestamps are epoch-ms (~1.7e12), safely above these
// sentinels, so the comment always sorts first and the baseline second.
const COMMENT_SORT = Number.MIN_SAFE_INTEGER;
const BASELINE_SORT = Number.MIN_SAFE_INTEGER + 1;

function parseSortKey(iso: string | undefined): number {
  if (!iso) {
    return 0;
  }
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? 0 : ts;
}

function kindWeight(entry: TranscriptEntry): number {
  if (entry.kind === "comment") {
    return 0;
  }
  return entry.kind === "variants" ? 1 : 2;
}

interface VersionGroup {
  createdAt?: string;
  isBaseline: boolean;
  versions: IterationVersion[];
}

/**
 * Group versions into agent runs. The manifest persists only `createdAt` per
 * version (no run id survives a reload), but every version written in one
 * iterate run shares a single `createdAt` — so that's the grouping key. The
 * baseline (`v0`) is always its own group regardless of timestamp.
 */
function groupVersions(versions: IterationVersion[]): VersionGroup[] {
  const map = new Map<string, IterationVersion[]>();
  for (const v of versions) {
    const key = v.v === 0 ? "baseline" : (v.createdAt ?? `__v${v.v}`);
    const list = map.get(key) ?? [];
    list.push(v);
    map.set(key, list);
  }
  const groups: VersionGroup[] = [];
  for (const [key, list] of map) {
    list.sort((a, b) => a.v - b.v);
    groups.push({
      isBaseline: key === "baseline",
      createdAt: list[0]?.createdAt,
      versions: list,
    });
  }
  return groups;
}

/**
 * Build the ordered conversation for a comment. Version chrome (baseline +
 * fix groups) only appears once at least one fix exists — a fresh comment with
 * just its baseline reads as a plain note with an empty conversation below.
 */
export function buildTranscript(args: {
  id: string;
  text: string;
  author: string;
  date: string;
  replies?: CommentReply[];
  versions: IterationVersion[];
}): TranscriptEntry[] {
  const { id, text, author, date, replies, versions } = args;
  const entries: TranscriptEntry[] = [
    { kind: "comment", sortKey: COMMENT_SORT, id, text, author, date },
  ];

  for (let i = 0; i < (replies?.length ?? 0); i++) {
    const reply = replies?.[i];
    if (!reply) {
      continue;
    }
    entries.push({
      kind: "reply",
      sortKey: parseSortKey(reply.date),
      reply,
      replyIndex: i,
    });
  }

  const hasFixes = versions.some((v) => v.v > 0);
  if (hasFixes) {
    for (const group of groupVersions(versions)) {
      entries.push({
        kind: "variants",
        isBaseline: group.isBaseline,
        createdAt: group.createdAt,
        versions: group.versions,
        sortKey: group.isBaseline
          ? BASELINE_SORT
          : parseSortKey(group.createdAt),
      });
    }
  }

  entries.sort((a, b) =>
    a.sortKey === b.sortKey
      ? kindWeight(a) - kindWeight(b)
      : a.sortKey - b.sortKey
  );
  return entries;
}
