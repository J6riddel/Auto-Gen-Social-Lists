/**
 * Socialpruf REST client.
 *
 * Every data endpoint needs x-api-key AND x-team-id. The team id isn't a
 * secret, but there's no way to get it without a call, so it's resolved once
 * from GET /developer/v1/teams and cached for the life of the process — one
 * key is assumed to belong to one team.
 */

import { keyFor } from "./keyring.js";

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

const teamIdCache = new Map<string, string>();

async function teamIdFor(orgSlug: string): Promise<string> {
  const cached = teamIdCache.get(orgSlug);
  if (cached) return cached;

  const teams = await request<Team[]>({ orgSlug, path: "/developer/v1/teams" });
  const team = teams[0];
  if (!team) {
    throw new Error(`Org "${orgSlug}"'s API key isn't attached to any team`);
  }

  teamIdCache.set(orgSlug, team.id);
  return team.id;
}

export interface AccountRecord {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  lastSyncedAt: string | null; // ISO datetime, null if never synced
  platformAccountUrl: string | null;
}

/** All tracked social accounts for the org's team. Identity/metadata only —
 *  follower counts live on statsByEntity, not here. */
export async function listAccounts(orgSlug: string): Promise<AccountRecord[]> {
  const teamId = await teamIdFor(orgSlug);
  return request<AccountRecord[]>({
    orgSlug,
    teamId,
    path: "/developer/v1/socialAccounts",
  });
}

interface StatsByEntityRow {
  id: string;
  name: string;
  platform: string;
  metrics: { followers: number; emv: number; [key: string]: number };
}

interface StatsByEntityResponse {
  data: StatsByEntityRow[];
}

export interface FollowerRow {
  id: string;
  name: string;
  handle: string | null;
  followers: number;
}

/** Current follower count per entity across one or more platforms. No date
 *  range — this is a point-in-time gauge, matching the "followers" metric's
 *  semantics (config/orgs.json requires dateRange to be null for it).
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
export async function fetchFollowers(
  orgSlug: string,
  platforms: string[],
): Promise<FollowerRow[]> {
  const teamId = await teamIdFor(orgSlug);
  const { data } = await request<StatsByEntityResponse>({
    orgSlug,
    teamId,
    path: "/developer/v1/statsByEntity",
    query: { groupBy: "brand", platform: platforms.join(",") },
  });
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    handle: null,
    followers: row.metrics.followers,
  }));
}

export interface EmvRow {
  entityId: string;
  name: string;
  handle: string | null;
  emv: number;
}

/** EMV per entity across one or more platforms, summed over [start, end].
 *  Same groupBy=brand reasoning as fetchFollowers applies. */
export async function fetchEmvByEntity(
  orgSlug: string,
  platforms: string[],
  start: string,
  end: string,
): Promise<EmvRow[]> {
  const teamId = await teamIdFor(orgSlug);
  const { data } = await request<StatsByEntityResponse>({
    orgSlug,
    teamId,
    path: "/developer/v1/statsByEntity",
    query: {
      groupBy: "brand",
      platform: platforms.join(","),
      fromDate: start,
      toDate: end,
    },
  });
  return data.map((row) => ({
    entityId: row.id,
    name: row.name,
    handle: null,
    emv: row.metrics.emv,
  }));
}
