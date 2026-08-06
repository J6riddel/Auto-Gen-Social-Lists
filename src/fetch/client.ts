/**
 * Socialpruf REST client.
 *
 * Every data endpoint needs x-api-key AND x-team-id. Team ids aren't secret,
 * but there's no way to get them without a call, so GET /developer/v1/teams
 * is resolved once and cached for the life of the process.
 *
 * A key can be attached to more than one team workspace — confirmed for
 * nfl-league, whose key is split across one workspace per division (NFC
 * North, AFC East, ...) rather than one workspace for the whole league. Using
 * only the first team silently returned one division and called it the
 * league. Every read below fans out across all of an org's team workspaces
 * and merges the result, so a single-workspace org (nhl-league, nba-league,
 * mlb-league) just does one request same as before.
 */

import { keyFor } from "./keyring.js";
import { canonicalTeamKey } from "../teamNames.js";

const BASE = process.env.SP_API_BASE ?? "https://socialpruf.com";

interface RequestOpts {
  orgSlug: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  teamId?: string;
}

async function request<T>({ orgSlug, path, query, teamId }: RequestOpts): Promise<T> {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = {
    "x-api-key": keyFor(orgSlug),
    Accept: "application/json",
  };
  if (teamId) headers["x-team-id"] = teamId;

  const res = await fetch(url, { headers });

  if (!res.ok) {
    // Note the URL is logged without the header — never interpolate the key
    // into a URL string, or it lands in logs and Actions can't mask it.
    throw new Error(
      `Socialpruf ${res.status} on ${url.pathname} (org: ${orgSlug})`,
    );
  }
  return (await res.json()) as T;
}

interface Team {
  id: string;
  name: string;
  organizationId: string;
}

const teamIdsCache = new Map<string, string[]>();

async function teamIdsFor(orgSlug: string): Promise<string[]> {
  const cached = teamIdsCache.get(orgSlug);
  if (cached) return cached;

  const teams = await request<Team[]>({ orgSlug, path: "/developer/v1/teams" });
  if (teams.length === 0) {
    throw new Error(`Org "${orgSlug}"'s API key isn't attached to any team`);
  }

  const ids = teams.map((t) => t.id);
  teamIdsCache.set(orgSlug, ids);
  return ids;
}

/** Dedupes rows carried by more than one team workspace. Workspaces are
 *  expected to partition entities (one division per workspace), not overlap,
 *  but this makes overlap safe instead of double-counting a row's value. */
function dedupeBy<T, K>(rows: T[], keyFn: (row: T) => K): T[] {
  const seen = new Map<K, T>();
  for (const row of rows) if (!seen.has(keyFn(row))) seen.set(keyFn(row), row);
  return [...seen.values()];
}

export interface AccountRecord {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  lastSyncedAt: string | null; // ISO datetime, null if never synced
  platformAccountUrl: string | null;
  // Undocumented in the generic socialAccounts example but confirmed present
  // on every real row — see fetchInstagramLogosByName, which depends on it.
  cdnProfileImageUrl: string | null;
}

/** All tracked social accounts for the org's team. Identity/metadata only —
 *  follower counts live on statsByEntity, not here. */
export async function listAccounts(orgSlug: string): Promise<AccountRecord[]> {
  const teamIds = await teamIdsFor(orgSlug);
  const perTeam = await Promise.all(
    teamIds.map((teamId) =>
      request<AccountRecord[]>({ orgSlug, teamId, path: "/developer/v1/socialAccounts" }),
    ),
  );
  return dedupeBy(perTeam.flat(), (a) => a.id);
}

interface StatsByEntityRow {
  id: string;
  name: string;
  platform: string;
  metrics: { followers: number; emv: number; [key: string]: number };
  // Socialpruf's own re-hosted copy (cdn.socialpruf.com) — stable, unlike the
  // signed/expiring URLs on each platform's own CDN nested under `accounts`,
  // which aren't safe to embed since they go stale. Confirmed populated on
  // real brand-grouped rows despite the generic docs example showing null.
  cdnProfileImageUrl: string | null;
}

interface StatsByEntityResponse {
  data: StatsByEntityRow[];
}

/** Loose match key for joining a brand-grouped row's name to an account-
 *  grouped row's name — the two aren't guaranteed identical casing/decoration
 *  (confirmed: the league's own account showed up as "nhl"/"NHL"/"@nhl"
 *  across platforms), so this is intentionally forgiving. Only used for the
 *  logo fallback below, never for anything numeric.
 *
 *  Routed through canonicalTeamKey rather than a plain lowercase/trim,
 *  because casing isn't the only thing that drifts between the two queries —
 *  confirmed on nfl-league: the brand-grouped call named an entity "Browns"
 *  while the account-grouped Instagram call named the same entity "Cleveland
 *  Browns" (and the reverse full/short mismatch for other teams), which a
 *  plain lowercase compare doesn't reconcile. */
export function normalizeBrandName(name: string): string {
  return canonicalTeamKey(name);
}

/** Instagram avatars keyed by normalized name — a fallback logo source.
 *  statsByEntity's brand-grouped cdnProfileImageUrl is whatever image
 *  Socialpruf has cached for the brand, which empirically isn't necessarily
 *  Instagram's own even when the query was scoped to platform=instagram
 *  (confirmed: a real instagram-only followers run still returned a TikTok —
 *  WebP, unrenderable by Satori — image for several teams).
 *
 *  Built from listAccounts, not statsByEntity's groupBy=account — that
 *  endpoint's `name` field turned out to be the raw platform *username*, not
 *  a display name (confirmed on nba-league: the Grizzlies' row there was
 *  "memgrizz", not "Memphis Grizzlies"). Joining on that only ever worked by
 *  coincidence, for whichever teams' handles happen to equal their own
 *  mascot name — real accounts fetched here expose `displayName` instead
 *  ("Memphis Grizzlies"), which is what actually lines up with the
 *  brand-grouped name on the other side of this join. There's no shared
 *  brand id at the account level to join on, so this still matches by name —
 *  good enough for team names in practice, even though name-matching is
 *  exactly what groupBy=brand exists to avoid for numeric stats. */
export async function fetchInstagramLogosByName(orgSlug: string): Promise<Map<string, string>> {
  const accounts = await listAccounts(orgSlug);
  const map = new Map<string, string>();
  for (const a of accounts) {
    if (a.platform !== "instagram" || !a.cdnProfileImageUrl) continue;
    map.set(normalizeBrandName(a.displayName ?? a.username), a.cdnProfileImageUrl);
  }
  return map;
}

export interface MetricRow {
  id: string;
  name: string;
  handle: string | null;
  value: number;
  logoUrl: string | null;
}

/** Any statsByEntity metric for one or more entities, keyed by the raw API
 *  field name (config/orgs.json's metrics[].apiField) — one fetch path for
 *  every stat Socialpruf exposes on a brand-grouped row (followers, emv,
 *  engagementRate, newFollowers, likes, impressions, ...), so adding a new
 *  metric to the config catalog needs no new fetch code. dateRange null means
 *  a point-in-time read (followers' semantics); set means summed/computed
 *  over [start, end] (everything else).
 *
 *  Grouped by brand, not account: an account is single-platform, and a
 *  brand's display name is inconsistent per platform ("nhl" on one, "NHL"
 *  on another, "@nhl" on a third — confirmed against real data), so
 *  grouping by account and re-joining client-side by name silently
 *  fragmented one entity into several. groupBy=brand sums across the
 *  requested platforms server-side instead, which is both correct and
 *  simpler. Assumes this org's rankable entities are Socialpruf brands —
 *  true for nhl-league (verified: 33 brands = 32 clubs + the league
 *  account), unverified for entityKind "creator" since no key is
 *  configured for that org yet. statsByEntity doesn't expose a per-entity
 *  handle, so handle is always null here. */
export async function fetchMetricByEntity(
  orgSlug: string,
  platforms: string[],
  apiField: string,
  dateRange: { start: string; end: string } | null,
): Promise<MetricRow[]> {
  const teamIds = await teamIdsFor(orgSlug);
  const perTeam = await Promise.all(
    teamIds.map((teamId) =>
      request<StatsByEntityResponse>({
        orgSlug,
        teamId,
        path: "/developer/v1/statsByEntity",
        query: {
          groupBy: "brand",
          platform: platforms.join(","),
          fromDate: dateRange?.start,
          toDate: dateRange?.end,
        },
      }),
    ),
  );
  const rows = perTeam.flatMap(({ data }) =>
    data.map((row) => ({
      id: row.id,
      name: row.name,
      handle: null,
      value: row.metrics[apiField] ?? NaN,
      logoUrl: row.cdnProfileImageUrl,
    })),
  );
  return dedupeBy(rows, (r) => r.id);
}
