/**
 * Spec -> data. Deterministic code, not an agent. Judgment decided what the
 * list is; this decides nothing and just goes and gets it.
 */

import { fetchEmvByEntity, fetchFollowers } from "./client.js";
import type { ListSpec, RankedList, RankedRow } from "../types.js";

/** statsByEntity groups by account, and an account is single-platform, so a
 *  multi-platform spec gets one row per platform per underlying entity back.
 *  Sum those into one ranked row per entity, keyed by name (the one field the
 *  API returns consistently across an entity's platform-specific accounts).
 *  For a single-platform spec every name appears once, so this is a no-op
 *  pass-through and entityId is unchanged from before this spec supported
 *  multiple platforms. */
function combineAcrossPlatforms(
  items: Array<{ id: string; name: string; handle: string | null; value: number }>,
): RankedRow[] {
  const byName = new Map<string, { ids: string[]; handle: string | null; value: number }>();
  for (const item of items) {
    const existing = byName.get(item.name);
    if (existing) {
      existing.ids.push(item.id);
      existing.value += item.value;
    } else {
      byName.set(item.name, { ids: [item.id], handle: item.handle, value: item.value });
    }
  }
  return [...byName.entries()].map(([name, g]) => ({
    entityId: g.ids.sort().join("+"),
    name,
    handle: g.handle,
    value: g.value,
  }));
}

export async function buildList(spec: ListSpec): Promise<RankedList> {
  let rows: RankedRow[];
  let rawQuery: Record<string, unknown>;

  if (spec.metric === "followers") {
    const accounts = await fetchFollowers(spec.orgSlug, spec.platforms);
    rows = combineAcrossPlatforms(
      accounts.map((a) => ({ id: a.id, name: a.name, handle: a.handle, value: a.followers })),
    );
    rawQuery = { route: "followers", org: spec.orgSlug, platforms: spec.platforms };
  } else {
    const { start, end } = spec.dateRange!;
    const emv = await fetchEmvByEntity(spec.orgSlug, spec.platforms, start, end);
    rows = combineAcrossPlatforms(
      emv.map((r) => ({ id: r.entityId, name: r.name, handle: r.handle, value: r.emv })),
    );
    rawQuery = {
      route: "stats/by-entity",
      org: spec.orgSlug,
      platforms: spec.platforms,
      metric: "emv",
      start,
      end,
    };
  }

  rows.sort((a, b) => (spec.sortDir === "desc" ? b.value - a.value : a.value - b.value));

  return {
    spec,
    rows: rows.slice(0, spec.topN),
    queriedAt: new Date().toISOString(),
    rawQuery,
  };
}
