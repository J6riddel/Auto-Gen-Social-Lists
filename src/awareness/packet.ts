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
import { probeAll } from "./probe.js";
import type { AwarenessPacket, MetricConfig, OrgConfig } from "../types.js";

const ORGS = orgsConfig.orgs as OrgConfig[];
const METRICS = orgsConfig.metrics as MetricConfig[];

/** Reads the last N receipts so judgment can avoid repeating itself. */
async function recentPosts(limit = 10) {
  try {
    const dirs = (await readdir("output", { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse()
      .slice(0, limit);

    const out = [];
    for (const dir of dirs) {
      try {
        const receipt = JSON.parse(
          await readFile(`output/${dir}/receipt.json`, "utf8"),
        );
        out.push({
          date: receipt.generatedAt?.slice(0, 10) ?? dir.slice(0, 10),
          title: receipt.spec.title,
          orgSlug: receipt.spec.orgSlug,
          metric: receipt.spec.metric,
          platforms: receipt.spec.platforms,
        });
      } catch {
        // skip malformed
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function buildPacket(): Promise<AwarenessPacket> {
  const coverage = await probeAll();
  const byslug = new Map(coverage.map((c) => [c.slug, c]));

  return {
    today: new Date().toISOString().slice(0, 10),
    orgs: ORGS.filter((o) => byslug.get(o.slug)?.reachable).map((o) => {
      const c = byslug.get(o.slug)!;
      return {
        slug: o.slug,
        label: o.label,
        entityKind: o.entityKind,
        entityCount: c.entityCount,
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
