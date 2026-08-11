/**
 * Durable posting history.
 *
 * Novelty used to be read from `output/`, which is gitignored and, in Actions,
 * lives on a runner destroyed when the job ends — so every scheduled run saw an
 * empty directory and could happily repeat yesterday's list. This file is
 * committed, so the Action and a laptop reason from the same history.
 *
 * It stores only the five fields the packet actually shows judgment. The receipt
 * remains the full record; this is deliberately a digest, because the repo is
 * public and the receipt's rows are client follower counts.
 *
 * JSONL rather than a JSON array so a run appends one line and never rewrites
 * existing ones — a same-day double run conflicts on nothing, and the diff of a
 * daily commit is a single added line.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ListSpec } from "../types.js";

export const HISTORY_PATH = "history/posts.jsonl";

export interface HistoryEntry {
  /** Full ISO timestamp, not a date. Several lists can share a day, and
   *  "recent" has to mean recent rather than alphabetical-by-title. */
  generatedAt: string;
  title: string;
  orgSlugs: string[];
  metric: string;
  platforms: string[];
}

export function historyEntry(spec: ListSpec, generatedAt: string): HistoryEntry {
  return {
    generatedAt,
    title: spec.title,
    orgSlugs: spec.orgSlugs,
    metric: spec.metric,
    platforms: spec.platforms,
  };
}

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  await appendFile(HISTORY_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

/** Missing file means no history yet, which is the same answer as an empty
 *  one. A malformed line is skipped rather than failing the run — losing one
 *  day of novelty beats blocking today's list on a bad past write. */
export async function readHistory(): Promise<HistoryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(HISTORY_PATH, "utf8");
  } catch {
    return [];
  }

  const entries: HistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as HistoryEntry;
      if (parsed?.title && parsed?.generatedAt) entries.push(parsed);
    } catch {
      // skip malformed
    }
  }
  return entries;
}
