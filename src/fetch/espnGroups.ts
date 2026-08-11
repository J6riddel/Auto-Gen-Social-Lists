/**
 * Conference membership, for orgs that are one conference inside a larger
 * ESPN league.
 *
 * The site API's /teams endpoint accepts a ?groups= parameter and ignores it —
 * confirmed on college football, where it returns the same alphabetical slice
 * of all 758 schools (Division III included) whatever you pass. Membership
 * only exists on the core API's group document, which lists team ids and
 * nothing else, so callers join those ids back to the site API records that
 * carry the names, colors and logos.
 *
 * Same posture as leagueRoster.ts and espnAssets.ts, which talk to the same
 * host: no Socialpruf key, no user data, read-only, fail-open. null means
 * "couldn't determine membership" and callers must treat it as "don't filter"
 * — an unreachable reference dataset is not evidence that a conference is
 * empty.
 */

const CORE_API = "https://sports.core.api.espn.com/v2/sports";

const TIMEOUT_MS = 6000;

/** Cached for the process: buildList and renderCard each need the same
 *  conference, and a run should not ask ESPN the same question twice. */
const cache = new Map<string, Set<string> | null>();

interface GroupTeamsResponse {
  items?: Array<{ $ref?: string }>;
}

interface GroupDoc {
  id?: string;
  name?: string;
  children?: { $ref?: string };
  logos?: Array<{ href?: string }>;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface EspnSubgroup {
  id: number;
  name: string;
}

const subgroupCache = new Map<string, EspnSubgroup[]>();

/**
 * The named subgroups an org can be narrowed to: an org mapped to a whole
 * league gets its conferences *and* their divisions ("American Football
 * Conference", "AFC East"), and an org already scoped to one conference gets
 * that conference's divisions.
 *
 * Discovered live rather than declared in config, for the same reason the
 * roster check is: divisions realign, and a hand-maintained table of them is
 * a thing that silently goes stale. Returns [] on any failure, which reads
 * downstream as "this org offers no subgroups" — the org still ranks whole.
 */
export async function fetchSubgroups(
  espnLeaguePath: string,
  parentGroupId: number | null,
  today: Date = new Date(),
): Promise<EspnSubgroup[]> {
  const [sport, league] = espnLeaguePath.split("/");
  if (!sport || !league) return [];

  const cacheKey = `${espnLeaguePath}/${parentGroupId ?? "root"}`;
  const cached = subgroupCache.get(cacheKey);
  if (cached) return cached;

  const year = today.getUTCFullYear();
  let found: EspnSubgroup[] = [];

  for (const season of [year, year - 1]) {
    const base = `${CORE_API}/${sport}/leagues/${league}/seasons/${season}/types/2/groups`;
    const rootRefs: string[] = [];

    if (parentGroupId === null) {
      const list = await getJson<GroupTeamsResponse>(`${base}?limit=100`);
      for (const it of list?.items ?? []) if (it.$ref) rootRefs.push(it.$ref);
    } else {
      rootRefs.push(`${base}/${parentGroupId}`);
    }
    if (rootRefs.length === 0) continue;

    const out: EspnSubgroup[] = [];
    for (const ref of rootRefs) {
      const doc = await getJson<GroupDoc>(ref);
      if (!doc) continue;
      // A conference is itself a selectable subgroup of a whole league, but
      // not of itself — narrowing "the SEC" to "the SEC" is a no-op.
      if (parentGroupId === null && doc.id && doc.name) {
        out.push({ id: Number(doc.id), name: doc.name });
      }
      if (!doc.children?.$ref) continue;
      const kids = await getJson<GroupTeamsResponse>(doc.children.$ref);
      for (const it of kids?.items ?? []) {
        const kid = it.$ref ? await getJson<GroupDoc>(it.$ref) : null;
        if (kid?.id && kid.name) out.push({ id: Number(kid.id), name: kid.name });
      }
    }

    if (out.length > 0) {
      found = out.filter((g) => Number.isFinite(g.id));
      break;
    }
  }

  subgroupCache.set(cacheKey, found);
  return found;
}

/** The conference's own mark, for a row that *is* a conference rather than a
 *  team. College conference groups publish one (ncaa_conf/…/sec.png); pro
 *  league groups do not, so this returns null there and the row falls back to
 *  the same placeholder any logo-less row uses. */
export async function fetchGroupLogoUrl(
  espnLeaguePath: string,
  groupId: number,
  today: Date = new Date(),
): Promise<string | null> {
  const [sport, league] = espnLeaguePath.split("/");
  if (!sport || !league) return null;

  const year = today.getUTCFullYear();
  for (const season of [year, year - 1]) {
    const doc = await getJson<GroupDoc>(
      `${CORE_API}/${sport}/leagues/${league}/seasons/${season}/types/2/groups/${groupId}`,
    );
    const href = doc?.logos?.find((l) => l.href)?.href;
    if (href) return href;
  }
  return null;
}

/** Name -> group id, case-insensitively, so a spec can name a division the way
 *  a human writes it. null when the org has no such subgroup. */
export async function resolveSubgroupId(
  espnLeaguePath: string,
  parentGroupId: number | null,
  name: string,
): Promise<number | null> {
  const subs = await fetchSubgroups(espnLeaguePath, parentGroupId);
  const want = name.trim().toLowerCase();
  return subs.find((s) => s.name.toLowerCase() === want)?.id ?? null;
}

/** The team id is already embedded in each item's `$ref`, so a conference
 *  resolves in one request rather than one per team. */
function teamIdFromRef(ref: string | undefined): string | null {
  return ref?.match(/teams\/(\d+)/)?.[1] ?? null;
}

/**
 * ESPN team ids belonging to `groupId` within `espnLeaguePath`.
 *
 * Tries the current season then the previous one: next season's group document
 * publishes well before that season starts, but during the early part of a
 * calendar year the current year's may not exist yet. Same fallback shape as
 * espnAssets.ts's leaders lookup, and it matters more here — conference
 * membership changes every realignment cycle, so pinning a season would
 * silently rank last year's league.
 */
export async function fetchConferenceTeamIds(
  espnLeaguePath: string,
  groupId: number,
  today: Date = new Date(),
): Promise<Set<string> | null> {
  const [sport, league] = espnLeaguePath.split("/");
  if (!sport || !league) return null;

  const cacheKey = `${espnLeaguePath}/${groupId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const year = today.getUTCFullYear();
  let result: Set<string> | null = null;

  for (const season of [year, year - 1]) {
    try {
      const res = await fetch(
        `${CORE_API}/${sport}/leagues/${league}/seasons/${season}/types/2/groups/${groupId}/teams?limit=100`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (!res.ok) continue;

      const data = (await res.json()) as GroupTeamsResponse;
      const ids = new Set<string>();
      for (const item of data.items ?? []) {
        const id = teamIdFromRef(item.$ref);
        if (id) ids.add(id);
      }
      // An empty group is a 200 with no items, which reads the same as a
      // season that hasn't been populated — keep trying rather than caching
      // an empty conference.
      if (ids.size > 0) {
        result = ids;
        break;
      }
    } catch {
      // Fall through to the previous season, then give up.
    }
  }

  cache.set(cacheKey, result);
  return result;
}
