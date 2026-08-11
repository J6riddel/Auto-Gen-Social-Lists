/**
 * Render-time art direction pulled from ESPN's public endpoints: a transparent
 * team logo, the official team color, and a headshot of each top team's
 * statistical leader.
 *
 * Why not use what fetch already returns: Socialpruf's `logoUrl` is whatever
 * avatar the source platform had — a square photo with its own background,
 * often a wordmark or a cropped promo image. That reads fine as a small round
 * chip but not as a crest sitting on a light panel, which is what the card
 * design calls for. ESPN publishes the actual mark on transparency at a
 * consistent size, so it's preferred here and Socialpruf's avatar stays as the
 * fallback.
 *
 * Same posture as leagueRoster.ts, which already talks to the same host: no
 * Socialpruf key, no user data, read-only, and every failure is fail-open. A
 * card renders without any of this — logos degrade to the Socialpruf avatar,
 * colors to the static table, faces to no photo panel at all. None of it is a
 * claim the card is making, so none of it is worth failing a run over.
 */

import { fetchConferenceTeamIds, fetchGroupLogoUrl } from "../fetch/espnGroups.js";
import { getOrg } from "../fetch/keyring.js";
import { canonicalTeamKey } from "../teamNames.js";

const SITE_API = "https://site.api.espn.com/apis/site/v2/sports";
const CORE_API = "https://sports.core.api.espn.com/v2/sports";
const HEADSHOT_CDN = "https://a.espncdn.com/i/headshots";

const TIMEOUT_MS = 6000;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** ESPN reports colors as bare hex with no "#", and occasionally as an empty
 *  string rather than omitting the field. */
function toHex(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toLowerCase()}` : null;
}

interface EspnTeamsResponse {
  sports: Array<{
    leagues: Array<{
      teams: Array<{
        team: {
          id: string;
          name?: string;
          displayName: string;
          shortDisplayName?: string;
          location?: string;
          color?: string;
          alternateColor?: string;
          logos?: Array<{ href: string; rel: string[] }>;
        };
      }>;
    }>;
  }>;
}

export interface EspnTeam {
  teamId: string;
  /** The row label, straight from ESPN — mascot form ("Kings") for a pro
   *  league, school form ("Alabama") for a college org, per the org's
   *  nameStyle. Authoritative in a way teamNames.ts's table can't be: it comes
   *  from the same roster the team was matched against, so it can't drift out
   *  of date. */
  shortName: string;
  /** Transparent-background PNG of the team mark. */
  logoUrl: string | null;
  /** Official primary color, "#rrggbb". */
  color: string | null;
  altColor: string | null;
}

export interface EspnLeague {
  sport: string;
  league: string;
  /** Keyed by canonicalTeamKey — the mascot form for a pro league (ESPN's
   *  `name` field is already the mascot) and the school form for a college
   *  org. Row names arrive in either full or short form, so both sides route
   *  through the same normalizer. Scoped to one league (or one conference) per
   *  load, which is what makes mascot-only keys safe despite Kings/Rangers/
   *  Jets/Panthers/Giants/Cardinals colliding across leagues. */
  teams: Map<string, EspnTeam>;
  /** Mascot -> team, longest mascot first, for the trailing-mascot fallback in
   *  lookupEspnTeam. Empty for a school-style org, where the mascot is not a
   *  unique key even within one conference. */
  mascots: Array<[string, EspnTeam]>;
  /** School -> team, longest school first, for the leading-school fallback in
   *  lookupEspnTeam. Empty for a mascot-style org. */
  schools: Array<[string, EspnTeam]>;
}

/** ESPN ships several logo variants per team (see the `rel` tags). The plain
 *  "default" one is the full-color mark on transparency, which is what sits on
 *  the card's light logo panel. The "dark" variant is the same mark recolored
 *  for dark backgrounds and would disappear against a white panel, so it is
 *  explicitly not what we want here. */
function pickLogo(logos: Array<{ href: string; rel: string[] }> | undefined): string | null {
  if (!logos?.length) return null;
  const isDefault = logos.find((l) => l.rel.includes("default") && !l.rel.includes("dark"));
  const anyLight = logos.find((l) => !l.rel.includes("dark"));
  return isDefault?.href ?? anyLight?.href ?? logos[0]!.href;
}

export async function loadEspnLeague(orgSlug: string): Promise<EspnLeague | null> {
  const org = getOrg(orgSlug);
  if (!org.espnLeaguePath) return null;

  const [sport, league] = org.espnLeaguePath.split("/");
  if (!sport || !league) return null;

  // limit: college football pages at 50 by default across 758 schools, which
  // would silently drop most of a conference. Harmless for the pro leagues.
  const data = await getJson<EspnTeamsResponse>(
    `${SITE_API}/${org.espnLeaguePath}/teams?limit=1000`,
  );
  let raw = data?.sports?.[0]?.leagues?.[0]?.teams;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  // Narrow a conference org to its own conference, so the index a row is
  // looked up in holds only that org's teams — the same scoping that makes
  // short-form keys unambiguous for the pro leagues.
  if (org.espnGroupId !== null) {
    const ids = await fetchConferenceTeamIds(org.espnLeaguePath, org.espnGroupId);
    if (ids) raw = raw.filter(({ team }) => ids.has(team.id));
    if (raw.length === 0) return null;
  }

  // In college the school is the identity and the mascot is not unique: three
  // SEC programs are "Tigers", so a mascot-labelled card would print the same
  // row three times and the shared index would resolve all three to whichever
  // was written last. ESPN's `location` is the school ("Alabama", "Ohio
  // State"), which is both unique in-conference and what a fan actually says.
  const school = org.nameStyle === "school";

  const teams = new Map<string, EspnTeam>();
  const mascots: Array<[string, EspnTeam]> = [];
  const schools: Array<[string, EspnTeam]> = [];
  for (const { team } of raw) {
    const primary = school ? team.location : team.name;
    const entry: EspnTeam = {
      teamId: team.id,
      shortName: primary ?? team.shortDisplayName ?? team.displayName,
      logoUrl: pickLogo(team.logos),
      color: toHex(team.color),
      altColor: toHex(team.alternateColor),
    };
    // Every name form the team might arrive as, so a row named "Los Angeles
    // Dodgers" and one named "Dodgers" both resolve. canonicalTeamKey folds
    // full names to the mascot, so these usually collapse to one key anyway.
    for (const form of [primary, team.displayName, team.shortDisplayName]) {
      if (form) teams.set(canonicalTeamKey(form), entry);
    }
    if (school) {
      if (team.location) schools.push([looseName(team.location), entry]);
    } else if (team.name) {
      mascots.push([looseName(team.name), entry]);
    }
  }

  // Longest first so a two-word key wins over a one-word suffix of itself
  // ("Maple Leafs" before any hypothetical "Leafs"), and so "Michigan State"
  // is tried before "Michigan" against a row named "Michigan State Football".
  mascots.sort((a, b) => b[0].length - a[0].length);
  schools.sort((a, b) => b[0].length - a[0].length);

  return { sport, league, teams, mascots, schools };
}

/** Lowercase, punctuation folded to spaces, whitespace collapsed. Folding
 *  rather than stripping is the point: Socialpruf writes "St.Louis Blues" with
 *  no space after the period, and stripping would produce "stlouis blues"
 *  while folding produces "st louis blues" — the form that actually matches. */
function looseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** One index per org, for a list that pools several. Built in parallel and
 *  independently: a league that fails to load leaves its own rows on the
 *  Socialpruf avatar without affecting the others. */
export async function loadEspnLeagues(
  orgSlugs: string[],
): Promise<Map<string, EspnLeague | null>> {
  const entries = await Promise.all(
    [...new Set(orgSlugs)].map(
      async (slug): Promise<[string, EspnLeague | null]> => [slug, await loadEspnLeague(slug)],
    ),
  );
  return new Map(entries);
}

/** The mark for a row that is a whole org — a conference crest rather than a
 *  team crest. null for an org with no ESPN group of its own (a whole league),
 *  which has no such image to publish. */
export async function loadOrgMarkUrl(orgSlug: string): Promise<string | null> {
  const org = getOrg(orgSlug);
  if (!org.espnLeaguePath || org.espnGroupId === null) return null;
  return fetchGroupLogoUrl(org.espnLeaguePath, org.espnGroupId);
}

/** The only words a leading-school match is allowed to swallow: what a program
 *  appends to its own name on its own account. Everything else after a school
 *  name marks a *different* school — "Alabama State" and "Alabama A&M" are not
 *  Alabama, "Miami OH" is not Miami, "Washington State" is not Washington. That
 *  distinction cannot be left to the roster check alone, because that check
 *  fails open when ESPN is unreachable, and the failure it would let through
 *  here is a card labelled ALABAMA showing Alabama State's numbers. */
const PROGRAM_SUFFIXES = new Set([
  "football",
  "athletics",
  "sports",
  "fb",
  "gameday",
  "official",
]);

/** Exact canonical match first, then a trailing-mascot match for the names
 *  Socialpruf writes in a form the shared table doesn't carry — confirmed on
 *  real data for "LA Kings", "LA Rams", "St.Louis Blues" and the outdated
 *  "Anaheim Angels", all of which resolved to nothing and rendered as a blank
 *  logo panel.
 *
 *  The heuristic is only safe because this index holds one league at a time:
 *  "Kings" is ambiguous across the NHL and NBA but unique inside either, and
 *  an org with no espnLeaguePath (creators) never builds an index at all, so a
 *  creator whose handle happens to end in a mascot word can't be caught by
 *  it. */
export function lookupEspnTeam(league: EspnLeague | null, rowName: string): EspnTeam | null {
  if (!league) return null;

  const exact = league.teams.get(canonicalTeamKey(rowName));
  if (exact) return exact;

  const loose = looseName(rowName);
  // College accounts lead with the school and trail with a word the roster
  // doesn't carry — "Alabama Football", "Texas Athletics" — which is the
  // mirror image of the pro case, so school-style orgs match on the front of
  // the name and mascot-style ones on the back. Only one list is ever
  // populated, so the two rules can't fight over the same row.
  for (const [school, team] of league.schools) {
    if (loose === school) return team;
    if (!loose.startsWith(`${school} `)) continue;
    // Only swallow a remainder that is purely program-suffix words. A row that
    // continues into anything else is a neighbouring school that merely shares
    // a prefix, and returning `team` for it would relabel it as this one.
    const rest = loose.slice(school.length + 1).split(" ").filter(Boolean);
    if (rest.every((w) => PROGRAM_SUFFIXES.has(w))) return team;
  }
  for (const [mascot, team] of league.mascots) {
    if (loose === mascot || loose.endsWith(` ${mascot}`)) return team;
  }
  return null;
}

interface LeadersResponse {
  categories?: Array<{
    name?: string;
    leaders?: Array<{ athlete?: { $ref?: string } }>;
  }>;
}

/** The athlete id is already embedded in the leaders payload's `$ref`, so the
 *  headshot URL is derivable without resolving each athlete document — one
 *  request per team, not one per leader. */
function athleteIdFromRef(ref: string | undefined): string | null {
  return ref?.match(/athletes\/(\d+)/)?.[1] ?? null;
}

/** The athlete topping the most statistical categories for this team, which is
 *  a usable stand-in for "the face of the team" without asking a model to pick
 *  one. Deterministic on purpose — the same run must render the same card, and
 *  a judgment call here would be a second, unrecorded decision outside the
 *  receipt.
 *
 *  Sport-agnostic by construction: it counts category wins rather than naming
 *  a category, so it needs no per-league table of which stat matters (home runs
 *  vs passing yards vs points vs goals). Ties break toward whichever athlete
 *  ESPN lists in the earlier category, which is stable across calls. */
function faceOfTeam(data: LeadersResponse): string | null {
  const tally = new Map<string, number>();
  for (const category of data.categories ?? []) {
    const id = athleteIdFromRef(category.leaders?.[0]?.athlete?.$ref);
    if (!id) continue;
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }

  let best: { id: string; n: number } | null = null;
  for (const [id, n] of tally) if (!best || n > best.n) best = { id, n };
  return best?.id ?? null;
}

/** ESPN's regular-season leaders (`types/2`) for a season that hasn't started
 *  yet 404 rather than returning an empty result — confirmed on NFL in August,
 *  where the current season exists but has no regular-season stats. Falling
 *  back one season keeps the panel populated during an off-season instead of
 *  silently dropping it for months at a time. */
export async function fetchLeaderHeadshotUrl(
  league: EspnLeague,
  teamId: string,
  today: Date,
): Promise<string | null> {
  const year = today.getUTCFullYear();
  for (const season of [year, year - 1]) {
    const data = await getJson<LeadersResponse>(
      `${CORE_API}/${league.sport}/leagues/${league.league}/seasons/${season}/types/2/teams/${teamId}/leaders`,
    );
    if (!data) continue;
    const athleteId = faceOfTeam(data);
    if (athleteId) return `${HEADSHOT_CDN}/${league.league}/players/full/${athleteId}.png`;
  }
  return null;
}
