import type { CommentReply } from "../../types.ts";
import type { IterationVersion } from "../hooks/use-iterations.ts";

/**
 * The comment's conversation, modelled as **turns**. A turn is an instruction
 * (the original comment, or a follow-up reply) plus the agent run(s) it
 * produced — so request and result read as one unit instead of three stacked
 * entries.
 *
 *   - The original comment is always the first turn.
 *   - Each reply is a turn. An agent-mode reply has the run it triggered
 *     attached beneath it; a plain comment-mode reply has no runs (a note).
 *   - The baseline (`v0`) is NOT a turn — it's returned separately and surfaced
 *     once as a quiet "Original" reference, since it's the starting state, not
 *     something the agent said.
 */
interface VariantRun {
  createdAt?: string;
  versions: IterationVersion[];
}

export type TurnInstruction =
  | { kind: "comment"; id: string; text: string; author: string; date: string }
  | { kind: "reply"; replyIndex: number; reply: CommentReply };

export interface TranscriptTurn {
  instruction: TurnInstruction;
  key: string;
  /** Agent runs produced in response to this instruction, oldest first. */
  runs: VariantRun[];
}

export interface Transcript {
  /** The v0 starting state, if it exists. */
  baseline?: IterationVersion;
  turns: TranscriptTurn[];
}

// The comment is pinned before every reply/run. Real timestamps are epoch-ms
// (~1.7e12), safely above this sentinel.
const COMMENT_TIME = Number.MIN_SAFE_INTEGER;

function parseTime(iso: string | undefined): number {
  if (!iso) {
    return 0;
  }
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? 0 : ts;
}

/**
 * Group fix versions (v > 0) into runs. Every version written in one iterate
 * run shares a single `createdAt` (the only run signal that survives a reload),
 * so that's the grouping key. Runs are returned oldest-first.
 */
function groupRuns(versions: IterationVersion[]): VariantRun[] {
  const map = new Map<string, IterationVersion[]>();
  for (const v of versions) {
    const key = v.createdAt ?? `__v${v.v}`;
    const list = map.get(key) ?? [];
    list.push(v);
    map.set(key, list);
  }
  const runs: VariantRun[] = [];
  for (const list of map.values()) {
    list.sort((a, b) => a.v - b.v);
    runs.push({ createdAt: list[0]?.createdAt, versions: list });
  }
  runs.sort((a, b) => parseTime(a.createdAt) - parseTime(b.createdAt));
  return runs;
}

export function buildTranscript(args: {
  id: string;
  text: string;
  author: string;
  date: string;
  replies?: CommentReply[];
  versions: IterationVersion[];
}): Transcript {
  const { id, text, author, date, replies, versions } = args;

  const baseline = versions.find((v) => v.v === 0);
  const runs = groupRuns(versions.filter((v) => v.v > 0));

  // Instructions, oldest first (comment pinned ahead of every reply).
  const turns: { turn: TranscriptTurn; time: number }[] = [
    {
      turn: {
        key: "comment",
        instruction: { kind: "comment", id, text, author, date },
        runs: [],
      },
      time: COMMENT_TIME,
    },
  ];
  for (let i = 0; i < (replies?.length ?? 0); i++) {
    const reply = replies?.[i];
    if (!reply) {
      continue;
    }
    turns.push({
      turn: {
        key: `reply-${i}`,
        instruction: { kind: "reply", replyIndex: i, reply },
        runs: [],
      },
      time: parseTime(reply.date),
    });
  }
  turns.sort((a, b) => a.time - b.time);

  // Attach each run to the latest instruction that precedes it. Because the
  // comment is pinned first, every run finds a home.
  for (const run of runs) {
    const runTime = parseTime(run.createdAt);
    let target = turns[0];
    for (const candidate of turns) {
      if (candidate.time <= runTime) {
        target = candidate;
      } else {
        break;
      }
    }
    target?.turn.runs.push(run);
  }

  return { turns: turns.map((t) => t.turn), baseline };
}
