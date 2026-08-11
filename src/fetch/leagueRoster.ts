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

import { fetchConferenceTeamIds, resolveSubgroupId } from "./espnGroups.js";
import { getOrg } from "./keyring.js";
import type { ListSpec, OrgConfig, RankedRow } from "../types.js";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

interface EspnTeamsResponse {
  sports: Array<{
    leagues: Array<{
      teams: Array<{
        team: {
          id: string;
          displayName: string;
          shortDisplayName?: string;
          name?: string;
          location?: string;
          abbreviation?: string;
        };
      }>;
    }>;
  }>;
}

/** Same normalization on both sides of the comparison: lowercase, punctuation
 *  to a space, collapse whitespace. Deliberately not routed through
 *  teamNames.ts's canonicalTeamKey — that table is exactly the kind of
 *  hand-maintained list this check exists to not depend on.
 *
 *  Punctuation becomes a space rather than being deleted because the two sides
 *  disagree about the space, not just the mark: Socialpruf's "St.Louis Blues"
 *  against ESPN's "St. Louis Blues" collapsed to "stlouis"/"st louis" and
 *  dropped a real team. Both sides run through here, so widening the split
 *  cannot desynchronize them. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every name form ESPN might reasonably be matched against for one team.
 *
 *  The bare mascot is included only for mascot-style orgs. Inside a pro league
 *  it is a unique identifier, but in college it is not even unique inside one
 *  conference — the SEC alone has Auburn, LSU and Missouri all named "Tigers",
 *  and Clemson is a fourth in the ACC. Accepting it there would let a row from
 *  a neighbouring conference pass this org's roster check, which is exactly
 *  the leak the check exists to close when several conference orgs read one
 *  shared workspace. */
function acceptedNames(
  team: EspnTeamsResponse["sports"][number]["leagues"][number]["teams"][number]["team"],
  nameStyle: OrgConfig["nameStyle"],
): string[] {
  const forms = [team.displayName, team.shortDisplayName, team.location];
  if (nameStyle === "mascot") forms.push(team.name);
  return forms.filter((n): n is string => Boolean(n)).map(normalize);
}

interface LeagueRoster {
  /** Every accepted name form, already normalized. */
  names: Set<string>;
  /** Mascot/location pairs, for the city-alias fallback below. Populated only
   *  for mascot-style orgs — nothing reads it otherwise. */
  cityForms: Array<{ mascot: string; location: string; abbreviation: string | null }>;
}

/** Whether `abbr` is `phrase` with each word cut short: every word must
 *  contribute at least its first letter, in order, and nothing may be left
 *  over. Covers plain initialisms ("la" / "los angeles") and the partial kind
 *  ("okc" / "oklahoma city") that a first-letters-only rule misses.
 *
 *  Not covered: forms that drop interior letters, like "phx" for "phoenix".
 *  ESPN's own abbreviation field is checked separately for those. */
function isAbbreviation(abbr: string, phrase: string): boolean {
  if (!abbr) return false;
  const words = phrase.split(" ");
  const walk = (ai: number, wi: number): boolean => {
    if (wi === words.length) return ai === abbr.length;
    const word = words[wi]!;
    for (let take = 1; take <= word.length && ai + take <= abbr.length; take++) {
      if (!word.startsWith(abbr.slice(ai, ai + take))) break;
      if (walk(ai + take, wi + 1)) return true;
    }
    return false;
  };
  return walk(0, 0);
}

/** Whether two spellings plausibly name the same place: identical, an
 *  abbreviation of one another in either direction (the row abbreviates for
 *  "LA Kings", ESPN abbreviates for "LA Clippers"), or one a word-subset of
 *  the other ("vegas" / "las vegas").
 *
 *  Deliberately narrow. It has to still hold "sacramento" and "los angeles"
 *  apart, or a Sacramento Kings row misfiled into the NHL org would pass the
 *  check on the strength of the mascot alone — the exact contamination this
 *  module exists to catch. */
function sameCity(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (isAbbreviation(a, b) || isAbbreviation(b, a)) return true;
  const aw = a.split(" ");
  const bw = b.split(" ");
  const [short, long] = aw.length <= bw.length ? [aw, bw] : [bw, aw];
  return short.every((w) => long.includes(w));
}

/** Second chance for a row whose city form differs from ESPN's: "LA Kings"
 *  against "Los Angeles Kings", "Los Angeles Clippers" against "LA Clippers".
 *  The mascot alone is never enough — the city has to corroborate it.
 *
 *  Only ever consulted for mascot-style orgs. In college the mascot is not
 *  unique inside a single conference (three SEC programs are "Tigers"), so
 *  matching on it there would let a neighbouring school's row pass this org's
 *  check, which is the leak acceptedNames already refuses to open. */
function matchesByCityAlias(name: string, roster: LeagueRoster): boolean {
  const resolved = roster.cityForms.filter(({ mascot, location, abbreviation }) => {
    if (!name.endsWith(` ${mascot}`)) return false;
    const city = name.slice(0, -mascot.length).trim();
    return city === abbreviation || sameCity(city, location);
  });
  // Exactly one, so a league that ever does field two same-mascot teams fails
  // closed rather than picking one of them.
  return resolved.length === 1;
}

/** Null means "couldn't get a roster" (network error, ESPN shape changed,
 *  org has no mapped league) — callers must treat that as fail-open, since an
 *  unreachable reference dataset is not evidence that a row is bad. */
async function fetchLeagueRoster(
  org: OrgConfig,
  groupId: number | null,
): Promise<LeagueRoster | null> {
  const espnLeaguePath = org.espnLeaguePath!;
  try {
    // limit is load-bearing for college football: the endpoint pages at 50 by
    // default and the league has 758 schools, so without it the roster would
    // be an alphabetical slice that drops most of every conference and takes
    // real teams down with it.
    const res = await fetch(`${ESPN_BASE}/${espnLeaguePath}/teams?limit=1000`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as EspnTeamsResponse;
    let teams = data.sports?.[0]?.leagues?.[0]?.teams;
    if (!Array.isArray(teams) || teams.length === 0) return null;

    // Narrow a conference org to its own conference. Fail-open on an
    // unresolvable group: the full-league roster is still a correct validity
    // check, just a looser one, which beats emptying the list.
    if (groupId !== null) {
      const ids = await fetchConferenceTeamIds(espnLeaguePath, groupId);
      if (ids) teams = teams.filter(({ team }) => ids.has(team.id));
      if (teams.length === 0) return null;
    }

    const names = new Set<string>();
    const cityForms: LeagueRoster["cityForms"] = [];
    for (const { team } of teams) {
      for (const n of acceptedNames(team, org.nameStyle)) names.add(n);
      if (org.nameStyle === "mascot" && team.name && team.location) {
        cityForms.push({
          mascot: normalize(team.name),
          location: normalize(team.location),
          abbreviation: team.abbreviation ? normalize(team.abbreviation) : null,
        });
      }
    }
    return { names, cityForms };
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
  // A pooled list holds rows from several orgs, and each has to be checked
  // against its own league — validating an NHL row against the NFL roster
  // would drop all of them. Grouping reorders rows, which is safe because
  // build.ts sorts after this runs.
  const bySlug = new Map<string, RankedRow[]>();
  for (const r of rows) {
    const group = bySlug.get(r.orgSlug);
    if (group) group.push(r);
    else bySlug.set(r.orgSlug, [r]);
  }

  const kept: RankedRow[] = [];
  const dropped: string[] = [];

  for (const [slug, orgRows] of bySlug) {
    const org = getOrg(slug);
    if (!org.espnLeaguePath) {
      kept.push(...orgRows);
      continue;
    }

    // A subgroup narrows below the org's own scope — the division inside a
    // league, or inside a conference. Fail open on an unresolvable name: the
    // org's normal roster is still a correct check, and verify's exact
    // row-count rule catches a list that then comes back the wrong size.
    let groupId = org.espnGroupId;
    if (spec.subgroup) {
      const resolved = await resolveSubgroupId(
        org.espnLeaguePath,
        org.espnGroupId,
        spec.subgroup,
      );
      if (resolved !== null) groupId = resolved;
    }

    const roster = await fetchLeagueRoster(org, groupId);
    if (!roster) {
      kept.push(...orgRows);
      continue;
    }

    const ownAccount = org.ownAccountName ? normalize(org.ownAccountName) : null;
    for (const r of orgRows) {
      const key = normalize(r.name);
      if (key === ownAccount || roster.names.has(key) || matchesByCityAlias(key, roster)) kept.push(r);
      else dropped.push(r.name);
    }
  }

  return { rows: kept, dropped };
}
