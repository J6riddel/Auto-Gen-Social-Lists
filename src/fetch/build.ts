/**
 * Spec -> data. Deterministic code, not an agent. Judgment decided what the
 * list is; this decides nothing and just goes and gets it.
 */

import { fetchInstagramLogosByName, fetchMetricByEntity, normalizeBrandName } from "./client.js";
import { getMetric, getOrg } from "./keyring.js";
import { filterToLeagueRoster } from "./leagueRoster.js";
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

/** Drops rows config/orgs.json has flagged as confirmed-bad data (e.g.
 *  nfl-league's "Detroit Tigers" — an MLB club misfiled under the NFL org).
 *  Unconditional, unlike applyOwnAccountExclusion: this isn't a per-list
 *  editorial choice, it's removing rows that were never a real entity. */
function applyBadDataExclusion(rows: RankedRow[], spec: ListSpec): RankedRow[] {
  const excluded = getOrg(spec.orgSlug).excludeEntityNames.map((n) => n.toLowerCase());
  if (excluded.length === 0) return rows;
  return rows.filter((r) => !excluded.includes(r.name.toLowerCase()));
}

export async function buildList(spec: ListSpec): Promise<RankedList> {
  const metric = getMetric(spec.metric);

  const [metricRows, instagramLogos] = await Promise.all([
    fetchMetricByEntity(spec.orgSlug, spec.platforms, metric.apiField, spec.dateRange),
    fetchInstagramLogosByName(spec.orgSlug),
  ]);
  let rows: RankedRow[] = metricRows.map((r) => ({
    entityId: r.id,
    name: r.name,
    handle: r.handle,
    value: r.value,
    logoUrl: r.logoUrl,
    logoUrlFallback: instagramLogos.get(normalizeBrandName(r.name)) ?? null,
  }));
  const rawQuery: Record<string, unknown> = {
    route: "statsByEntity",
    org: spec.orgSlug,
    platforms: spec.platforms,
    metric: spec.metric,
    ...(spec.dateRange ? { start: spec.dateRange.start, end: spec.dateRange.end } : {}),
  };

  rows = applyBadDataExclusion(rows, spec);

  const rosterCheck = await filterToLeagueRoster(rows, spec);
  rows = rosterCheck.rows;
  if (rosterCheck.dropped.length > 0) rawQuery.leagueRosterExcluded = rosterCheck.dropped;

  const beforeOwnAccountExclusion = rows.length;
  rows = applyOwnAccountExclusion(rows, spec);
  rawQuery.ownAccountExcluded = spec.excludeOwnAccount && rows.length < beforeOwnAccountExclusion;

  rows.sort((a, b) => (spec.sortDir === "desc" ? b.value - a.value : a.value - b.value));

  return {
    spec,
    rows: rows.slice(0, spec.topN),
    queriedAt: new Date().toISOString(),
    rawQuery,
  };
}
