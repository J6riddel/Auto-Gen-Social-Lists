/**
 * Socialpruf REST client.
 *
 * ⚠️ The three functions marked TODO are the only place real endpoint shapes
 * are needed. Everything else in the repo runs against these signatures, so
 * filling them in is the one integration task. Point Claude Code at your API
 * docs and have it implement these three against the real routes.
 */

import { keyFor } from "./keyring.js";

const BASE = process.env.SP_API_BASE ?? "https://api.socialpruf.com";

interface RequestOpts {
  orgSlug: string;
  path: string;
  query?: Record<string, string | number | undefined>;
}

async function request<T>({ orgSlug, path, query }: RequestOpts): Promise<T> {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${keyFor(orgSlug)}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    // Note the URL is logged without the header — never interpolate the key
    // into a URL string, or it lands in logs and Actions can't mask it.
    throw new Error(
      `Socialpruf ${res.status} on ${url.pathname} (org: ${orgSlug})`,
    );
  }
  return (await res.json()) as T;
}

export interface AccountRecord {
  id: string;
  name: string;
  handle: string | null;
  platform: string;
  followers: number;
  followersAsOf: string; // ISO date
}

/** TODO: point at the real accounts/entities route for an org. */
export async function listAccounts(orgSlug: string): Promise<AccountRecord[]> {
  const data = await request<{ accounts: AccountRecord[] }>({
    orgSlug,
    path: "/v1/accounts",
    query: { limit: 200 },
  });
  return data.accounts;
}

/** TODO: real follower-snapshot route. May be the same call as listAccounts —
 *  if so, delete this and have the fetch layer reuse the above. */
export async function fetchFollowers(
  orgSlug: string,
  platform: string,
): Promise<AccountRecord[]> {
  const accounts = await listAccounts(orgSlug);
  return accounts.filter((a) => a.platform === platform);
}

export interface EmvRow {
  entityId: string;
  name: string;
  handle: string | null;
  emv: number;
}

/** TODO: real aggregate route. Mirrors get_stats_by_entity in the MCP server —
 *  groupBy account, summed over the range. */
export async function fetchEmvByEntity(
  orgSlug: string,
  platform: string,
  start: string,
  end: string,
): Promise<EmvRow[]> {
  const data = await request<{ rows: EmvRow[] }>({
    orgSlug,
    path: "/v1/stats/by-entity",
    query: { groupBy: "account", platform, start, end, metric: "emv" },
  });
  return data.rows;
}
