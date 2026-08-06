/**
 * Awareness, live half. Asks each configured org what it actually has right
 * now, so judgment is constrained to feasible lists instead of discovering a
 * gap after it has already committed to an angle.
 *
 * Cached for the day — this runs before every generate and the answer does not
 * change hour to hour.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { configuredOrgs } from "../fetch/keyring.js";
import { listAccounts } from "../fetch/client.js";
import type { OrgCoverage } from "../types.js";

const CACHE_DIR = "cache";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function probeOrg(slug: string, expected: number): Promise<OrgCoverage> {
  try {
    const accounts = await listAccounts(slug);
    const platforms = [...new Set(accounts.map((a) => a.platform))].sort();
    const dates = accounts
      .map((a) => a.lastSyncedAt?.slice(0, 10))
      .filter((d): d is string => Boolean(d))
      .sort();

    const gaps: string[] = [];
    if (expected > 0 && accounts.length < expected) {
      gaps.push(`tracking ${accounts.length} of ${expected} expected accounts`);
    }
    const stale = accounts.filter(
      (a) => !a.lastSyncedAt || a.lastSyncedAt.slice(0, 10) < todayISO(),
    ).length;
    if (stale > 0) gaps.push(`${stale} accounts have stale or missing sync data`);

    return {
      slug,
      reachable: true,
      entityCount: accounts.length,
      platforms,
      freshestDataDate: dates.at(-1) ?? null,
      gaps,
    };
  } catch (err) {
    return {
      slug,
      reachable: false,
      entityCount: 0,
      platforms: [],
      freshestDataDate: null,
      gaps: [`unreachable: ${(err as Error).message}`],
    };
  }
}

export async function probeAll(useCache = true): Promise<OrgCoverage[]> {
  const cachePath = `${CACHE_DIR}/coverage-${todayISO()}.json`;

  if (useCache) {
    try {
      return JSON.parse(await readFile(cachePath, "utf8")) as OrgCoverage[];
    } catch {
      // cache miss, fall through
    }
  }

  const orgs = configuredOrgs();
  if (orgs.length === 0) {
    throw new Error("No orgs have keys set. Check .env against config/orgs.json.");
  }

  const coverage = await Promise.all(
    orgs.map((o) => probeOrg(o.slug, o.expectedEntityCount)),
  );

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify(coverage, null, 2));
  return coverage;
}

// `pnpm probe` — useful on its own when you want to see what's actually there.
// Compare via pathToFileURL, not a raw `file://${...}` template — argv[1] is
// an OS path (backslashes on Windows, unescaped spaces), not a URL, so a
// naive string comparison silently never matches there and the block never
// runs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  probeAll(false).then((c) => console.log(JSON.stringify(c, null, 2)));
}
