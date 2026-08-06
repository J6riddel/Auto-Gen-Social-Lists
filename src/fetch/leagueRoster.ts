/**
 * Live league-roster check. Supplements config/orgs.json's excludeEntityNames
 * (a human noticed a bad row during a probe and hardcoded its name) with a
 * per-run check against ESPN's public teams endpoint: whatever comes back
 * from Socialpruf for a league org must match a team ESPN currently lists for
 * that league, or it gets dropped. Catches contamination nobody has noticed
 * yet, and needs no maintenance when a team relocates or rebrands.
 *
 * Not a Socialpruf key, not user data, and read-only — doesn't touch any of
 * the secret-handling rules in keyring.ts.
 */

import { getOrg } from "./keyring.js";
import type { ListSpec, RankedRow } from "../types.js";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

interface EspnTeamsResponse {
  sports: Array<{
    leagues: Array<{
      teams: Array<{
        team: {
          displayName: string;
          shortDisplayName?: string;
          name?: string;
          location?: string;
        };
      }>;
    }>;
  }>;
}

/** Same normalization on both sides of the comparison: lowercase, strip
 *  anything that isn't a letter/digit/space, collapse whitespace. Deliberately
 *  not routed through teamNames.ts's canonicalTeamKey — that table is exactly
 *  the kind of hand-maintained list this check exists to not depend on. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every name form ESPN might reasonably be matched against for one team. */
function acceptedNames(team: EspnTeamsResponse["sports"][number]["leagues"][number]["teams"][number]["team"]): string[] {
  return [team.displayName, team.shortDisplayName, team.name, team.location]
    .filter((n): n is string => Boolean(n))
    .map(normalize);
}

/** Null means "couldn't get a roster" (network error, ESPN shape changed,
 *  org has no mapped league) — callers must treat that as fail-open, since an
 *  unreachable reference dataset is not evidence that a row is bad. */
async function fetchLeagueRosterNames(espnLeaguePath: string): Promise<Set<string> | null> {
  try {
    const res = await fetch(`${ESPN_BASE}/${espnLeaguePath}/teams`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as EspnTeamsResponse;
    const teams = data.sports?.[0]?.leagues?.[0]?.teams;
    if (!Array.isArray(teams) || teams.length === 0) return null;

    const names = new Set<string>();
    for (const { team } of teams) for (const n of acceptedNames(team)) names.add(n);
    return names;
  } catch {
    return null;
  }
}

export interface RosterFilterResult {
  rows: RankedRow[];
  dropped: string[];
}

/** Drops rows that don't match any team ESPN currently lists for this org's
 *  league. No-op for orgs with no espnLeaguePath (e.g. creators — there's no
 *  "roster" a creator belongs to) and fails open if ESPN can't be reached, so
 *  a network hiccup degrades to today's behavior instead of emptying a list.
 *  The org's own umbrella account is exempt — it was never going to be a team
 *  and whether it belongs in this list is applyOwnAccountExclusion's call. */
export async function filterToLeagueRoster(
  rows: RankedRow[],
  spec: ListSpec,
): Promise<RosterFilterResult> {
  const org = getOrg(spec.orgSlug);
  if (!org.espnLeaguePath) return { rows, dropped: [] };

  const roster = await fetchLeagueRosterNames(org.espnLeaguePath);
  if (!roster) return { rows, dropped: [] };

  const ownAccount = org.ownAccountName ? normalize(org.ownAccountName) : null;
  const dropped: string[] = [];
  const kept = rows.filter((r) => {
    const key = normalize(r.name);
    if (key === ownAccount || roster.has(key)) return true;
    dropped.push(r.name);
    return false;
  });

  return { rows: kept, dropped };
}
