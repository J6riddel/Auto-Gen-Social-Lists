/**
 * Awareness, live half. Asks each configured org what it actually has right
 * now, so judgment is constrained to feasible lists instead of discovering a
 * gap after it has already committed to an angle.
 *
 * Cached for the day — this runs before every generate and the answer does not
 * change hour to hour.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
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
      .map((a) => a.followersAsOf)
      .filter(Boolean)
      .sort();

    const gaps: string[] = [];
    if (expected > 0 && accounts.length < expected) {
      gaps.push(`tracking ${accounts.length} of ${expected} expected accounts`);
    }
    const stale = accounts.filter((a) => a.followersAsOf < todayISO()).length;
    if (stale > 0) gaps.push(`${stale} accounts have stale follower snapshots`);

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
if (import.meta.url === `file://${process.argv[1]}`) {
  probeAll(false).then((c) => console.log(JSON.stringify(c, null, 2)));
}
