/**
 * Spec -> data. Deterministic code, not an agent. Judgment decided what the
 * list is; this decides nothing and just goes and gets it.
 */

import { fetchEmvByEntity, fetchFollowers } from "./client.js";
import type { ListSpec, RankedList, RankedRow } from "../types.js";

export async function buildList(spec: ListSpec): Promise<RankedList> {
  let rows: RankedRow[];
  let rawQuery: Record<string, unknown>;

  if (spec.metric === "followers") {
    const accounts = await fetchFollowers(spec.orgSlug, spec.platforms);
    rows = accounts.map((a) => ({
      entityId: a.id,
      name: a.name,
      handle: a.handle,
      value: a.followers,
    }));
    rawQuery = { route: "followers", org: spec.orgSlug, platforms: spec.platforms };
  } else {
    const { start, end } = spec.dateRange!;
    const emv = await fetchEmvByEntity(spec.orgSlug, spec.platforms, start, end);
    rows = emv.map((r) => ({
      entityId: r.entityId,
      name: r.name,
      handle: r.handle,
      value: r.emv,
    }));
    rawQuery = {
      route: "stats/by-entity",
      org: spec.orgSlug,
      platforms: spec.platforms,
      metric: "emv",
      start,
      end,
    };
  }

  rows.sort((a, b) => (spec.sortDir === "desc" ? b.value - a.value : a.value - b.value));

  return {
    spec,
    rows: rows.slice(0, spec.topN),
    queriedAt: new Date().toISOString(),
    rawQuery,
  };
}
