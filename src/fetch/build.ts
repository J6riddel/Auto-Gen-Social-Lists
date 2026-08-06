/**
 * Spec -> data. Deterministic code, not an agent. Judgment decided what the
 * list is; this decides nothing and just goes and gets it.
 */

import { fetchEmvByEntity, fetchFollowers } from "./client.js";
import { getOrg } from "./keyring.js";
import type { ListSpec, RankedList, RankedRow } from "../types.js";

/** Drops the org's own umbrella account when judgment decided it isn't a
 *  peer of the entities being ranked. Mechanical execution of a decision
 *  judgment already made via spec.excludeOwnAccount — not itself a decision.
 *  Case-insensitive since the API doesn't guarantee casing consistency
 *  (confirmed: the same brand appeared as "nhl"/"NHL"/"@nhl" across
 *  different platform-scoped calls before groupBy=brand fixed that). */
function applyOwnAccountExclusion(rows: RankedRow[], spec: ListSpec): RankedRow[] {
  if (!spec.excludeOwnAccount) return rows;
  const ownAccountName = getOrg(spec.orgSlug).ownAccountName;
  if (!ownAccountName) return rows;
  return rows.filter((r) => r.name.toLowerCase() !== ownAccountName.toLowerCase());
}

export async function buildList(spec: ListSpec): Promise<RankedList> {
  let rows: RankedRow[];
  let rawQuery: Record<string, unknown>;

  if (spec.metric === "followers") {
    const accounts = await fetchFollowers(spec.orgSlug, spec.platforms);
    rows = accounts.map((a) => ({
      entityId: a.id,
      name: a.name,
      handle: a.handle,
      value: a.followers,
    }));
    rawQuery = { route: "followers", org: spec.orgSlug, platforms: spec.platforms };
  } else {
    const { start, end } = spec.dateRange!;
    const emv = await fetchEmvByEntity(spec.orgSlug, spec.platforms, start, end);
    rows = emv.map((r) => ({
      entityId: r.entityId,
      name: r.name,
      handle: r.handle,
      value: r.emv,
    }));
    rawQuery = {
      route: "stats/by-entity",
      org: spec.orgSlug,
      platforms: spec.platforms,
      metric: "emv",
      start,
      end,
    };
  }

  const beforeExclusion = rows.length;
  rows = applyOwnAccountExclusion(rows, spec);
  rawQuery.ownAccountExcluded = spec.excludeOwnAccount && rows.length < beforeExclusion;

  rows.sort((a, b) => (spec.sortDir === "desc" ? b.value - a.value : a.value - b.value));

  return {
    spec,
    rows: rows.slice(0, spec.topN),
    queriedAt: new Date().toISOString(),
    rawQuery,
  };
}
