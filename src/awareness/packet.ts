/**
 * Awareness, assembly. Turns config + live coverage + posting history into the
 * few hundred tokens the reasoner sees.
 *
 * Keep this small. Every field you add costs tokens on every run forever, and
 * a reasoner cannot hallucinate coverage it was never told about — that
 * property only holds if the packet stays curated rather than becoming a dump.
 */

import { readdir, readFile } from "node:fs/promises";
import orgsConfig from "../../config/orgs.json" with { type: "json" };
import { fetchSubgroups } from "../fetch/espnGroups.js";
import { readHistory, type HistoryEntry } from "./history.js";
import { probeAll } from "./probe.js";
import type { AwarenessPacket, MetricConfig, OrgConfig } from "../types.js";

const ORGS = orgsConfig.orgs as OrgConfig[];
const METRICS = orgsConfig.metrics as MetricConfig[];

/**
 * Local receipts. Runs generated on this machine before `history/` existed only
 * exist here, and a laptop that hasn't pulled still has runs the committed file
 * doesn't know about — so keep reading them and merge.
 */
async function receiptEntries(): Promise<HistoryEntry[]> {
  let dirs: string[];
  try {
    dirs = (await readdir("output", { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  const entries: HistoryEntry[] = [];
  for (const dir of dirs) {
    try {
      const receipt = JSON.parse(
        await readFile(`output/${dir}/receipt.json`, "utf8"),
      );
      entries.push({
        generatedAt: receipt.generatedAt ?? dir.slice(0, 10),
        title: receipt.spec.title,
        // Receipts written before lists could span orgs carry a single
        // `orgSlug`. Read both shapes so old runs still count for novelty
        // instead of silently reading as "no org" and letting judgment
        // repeat itself.
        orgSlugs: receipt.spec.orgSlugs ?? [receipt.spec.orgSlug].filter(Boolean),
        metric: receipt.spec.metric,
        platforms: receipt.spec.platforms,
      });
    } catch {
      // skip malformed
    }
  }
  return entries;
}

/**
 * The last N lists, so judgment can avoid repeating itself. Directory names all
 * share the same YYYY-MM-DD prefix on a day with multiple runs, so sorting by
 * name degenerates into sorting by slug text — not by recency. Sort by
 * generatedAt instead, so "recent" means recent.
 */
async function recentPosts(limit = 10) {
  const [committed, local] = await Promise.all([
    readHistory(),
    receiptEntries(),
  ]);

  // A run appends to history/ *and* writes a receipt, so on the machine that
  // produced it both sources carry the same list. Dedupe or it consumes two of
  // the ten novelty slots.
  const byKey = new Map<string, HistoryEntry>();
  for (const e of [...committed, ...local]) {
    byKey.set(`${e.generatedAt.slice(0, 10)}|${e.title}`, e);
  }

  return [...byKey.values()]
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, limit)
    .map((e) => ({
      date: e.generatedAt.slice(0, 10),
      title: e.title,
      orgSlugs: e.orgSlugs,
      metric: e.metric,
      platforms: e.platforms,
    }));
}

export async function buildPacket(): Promise<AwarenessPacket> {
  const coverage = await probeAll();
  const byslug = new Map(coverage.map((c) => [c.slug, c]));

  const reachable = ORGS.filter((o) => byslug.get(o.slug)?.reachable);

  // One ESPN round trip per org, cached in espnGroups for the process and
  // skipped entirely for orgs with no league mapped. Failure yields [], which
  // reads as "no subgroups offered" rather than breaking the packet.
  const subgroupsBySlug = new Map<string, string[]>(
    await Promise.all(
      reachable.map(async (o): Promise<[string, string[]]> => {
        if (!o.espnLeaguePath) return [o.slug, []];
        const subs = await fetchSubgroups(o.espnLeaguePath, o.espnGroupId);
        return [o.slug, subs.map((s) => s.name)];
      }),
    ),
  );

  return {
    today: new Date().toISOString().slice(0, 10),
    orgs: reachable.map((o) => {
      const c = byslug.get(o.slug)!;
      return {
        slug: o.slug,
        label: o.label,
        entityKind: o.entityKind,
        family: o.family,
        subgroups: subgroupsBySlug.get(o.slug) ?? [],
        // The probe counts social accounts, which is not the number of things
        // that can be ranked — nhl-league's 132 accounts are 33 entities x 4
        // platforms, and a conference org reading a shared workspace sees
        // every conference's accounts, not its own 16. Where config declares
        // the real roster, it wins: this is the number the feasibility gate
        // caps topN against, so an inflated one lets judgment propose a list
        // that verify can only fail.
        entityCount: o.rosterSize ?? c.entityCount,
        platforms: c.platforms,
        freshestDataDate: c.freshestDataDate,
        gaps: c.gaps,
        ownAccountName: o.ownAccountName,
      };
    }),
    metrics: METRICS,
    recentPosts: await recentPosts(),
  };
}
