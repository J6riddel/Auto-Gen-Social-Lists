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
  return rows.filter((r) => {
    const own = getOrg(r.orgSlug).ownAccountName;
    return !own || r.name.toLowerCase() !== own.toLowerCase();
  });
}

/** Drops rows config/orgs.json has flagged as confirmed-bad data (e.g.
 *  nfl-league's "Detroit Tigers" — an MLB club misfiled under the NFL org).
 *  Unconditional, unlike applyOwnAccountExclusion: this isn't a per-list
 *  editorial choice, it's removing rows that were never a real entity. */
function applyBadDataExclusion(rows: RankedRow[]): RankedRow[] {
  return rows.filter((r) => {
    const excluded = getOrg(r.orgSlug).excludeEntityNames;
    return !excluded.some((n) => n.toLowerCase() === r.name.toLowerCase());
  });
}

/** Collapses each org's surviving entities into a single row for that org.
 *  Only reached for an aggregable metric — the gate rejects rowKind "org" with
 *  a rate, because adding rates does not produce a rate. */
function aggregateByOrg(rows: RankedRow[], spec: ListSpec): RankedRow[] {
  return spec.orgSlugs.map((slug) => {
    const org = getOrg(slug);
    const members = rows.filter((r) => r.orgSlug === slug);
    return {
      entityId: slug,
      orgSlug: slug,
      name: org.label,
      handle: null,
      value: members.reduce((sum, r) => sum + r.value, 0),
      logoUrl: null,
      logoUrlFallback: null,
    };
  });
}

export async function buildList(spec: ListSpec): Promise<RankedList> {
  const metric = getMetric(spec.metric);

  // One pair of calls per org, in parallel. Each org resolves its own key
  // inside client.ts, so a pooled list never has to hold more than one.
  const perOrg = await Promise.all(
    spec.orgSlugs.map(async (slug) => {
      const [metricRows, instagramLogos] = await Promise.all([
        fetchMetricByEntity(slug, spec.platforms, metric.apiField, spec.dateRange),
        fetchInstagramLogosByName(slug),
      ]);
      return metricRows.map(
        (r): RankedRow => ({
          entityId: r.id,
          orgSlug: slug,
          name: r.name,
          handle: r.handle,
          value: r.value,
          logoUrl: r.logoUrl,
          logoUrlFallback: instagramLogos.get(normalizeBrandName(r.name)) ?? null,
        }),
      );
    }),
  );

  let rows: RankedRow[] = perOrg.flat();
  const rawQuery: Record<string, unknown> = {
    route: "statsByEntity",
    orgs: spec.orgSlugs,
    rowKind: spec.rowKind,
    ...(spec.subgroup ? { subgroup: spec.subgroup } : {}),
    platforms: spec.platforms,
    metric: spec.metric,
    ...(spec.dateRange ? { start: spec.dateRange.start, end: spec.dateRange.end } : {}),
  };

  rows = applyBadDataExclusion(rows);

  const rosterCheck = await filterToLeagueRoster(rows, spec);
  rows = rosterCheck.rows;
  if (rosterCheck.dropped.length > 0) rawQuery.leagueRosterExcluded = rosterCheck.dropped;

  const beforeOwnAccountExclusion = rows.length;
  rows = applyOwnAccountExclusion(rows, spec);
  rawQuery.ownAccountExcluded = spec.excludeOwnAccount && rows.length < beforeOwnAccountExclusion;

  // Aggregate after the exclusions, never before: an org total that still had
  // a misfiled row or the league's own account folded into it would be wrong
  // by exactly the amount those rows contribute.
  if (spec.rowKind === "org") {
    rawQuery.aggregatedFrom = rows.length;
    rows = aggregateByOrg(rows, spec);
  }

  rows.sort((a, b) => (spec.sortDir === "desc" ? b.value - a.value : a.value - b.value));

  return {
    spec,
    rows: rows.slice(0, spec.topN),
    queriedAt: new Date().toISOString(),
    rawQuery,
  };
}
