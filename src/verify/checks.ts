/**
 * Verification. This is where "claims must be provable" stops being a value
 * and becomes a function that can stop a post.
 *
 * Fails closed. A run that produces nothing is a fine outcome; a run that
 * produces a wrong ranking is not, because the correction lives on X forever.
 */

import { getMetric } from "../fetch/keyring.js";
import type { RankedList } from "../types.js";

export interface VerifyResult {
  ok: boolean;
  failures: string[];
  warnings: string[];
}

/** Values above this are almost certainly a unit error, not a real account. */
const IMPLAUSIBLE_FOLLOWERS = 500_000_000;

export function verify(list: RankedList): VerifyResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const { rows, spec } = list;
  const metric = getMetric(spec.metric);

  if (rows.length !== spec.topN) {
    failures.push(`expected ${spec.topN} rows, got ${rows.length}`);
  }

  for (const [i, r] of rows.entries()) {
    if (r.value === null || r.value === undefined || Number.isNaN(r.value)) {
      failures.push(`row ${i + 1} (${r.name}) has no value`);
    }
    // Most metrics failing this means bad data. Growth metrics (new_followers)
    // are the documented exception — a real follower loss is negative, not
    // an error (see config/orgs.json's allowNegative on that metric).
    if (r.value < 0 && !metric.allowNegative) {
      failures.push(`row ${i + 1} (${r.name}) is negative`);
    }
    if (!r.name?.trim()) failures.push(`row ${i + 1} has no name`);
  }

  if (spec.metric === "followers") {
    const wild = rows.filter((r) => r.value > IMPLAUSIBLE_FOLLOWERS);
    for (const r of wild) failures.push(`${r.name} at ${r.value} is implausible`);
  }

  // Ordering actually matches what we claim.
  const sorted = [...rows].sort((a, b) =>
    spec.sortDir === "desc" ? b.value - a.value : a.value - b.value,
  );
  if (sorted.some((r, i) => r.entityId !== rows[i]?.entityId)) {
    failures.push("rows are not in the order the spec claims");
  }

  // Duplicates — the same account tracked twice will silently double-rank.
  const ids = new Set(rows.map((r) => r.entityId));
  if (ids.size !== rows.length) failures.push("duplicate entities in the ranking");

  // Near-ties make the ordering meaningless even when it is technically correct.
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]!.value;
    const b = rows[i + 1]!.value;
    const denom = Math.max(Math.abs(a), 1);
    if (Math.abs(a - b) / denom < 0.002) {
      warnings.push(
        `ranks ${i + 1} and ${i + 2} differ by under 0.2% — ordering is arbitrary`,
      );
    }
  }

  // A flat list is not a story.
  const top = rows[0]?.value ?? 0;
  const bottom = rows.at(-1)?.value ?? 0;
  if (top > 0 && bottom / top > 0.95) {
    warnings.push("top and bottom are within 5% — the ranking has no spread");
  }

  return { ok: failures.length === 0, failures, warnings };
}
