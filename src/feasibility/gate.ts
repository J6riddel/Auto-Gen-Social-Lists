/**
 * Feasibility gate. Runs between judgment and fetch, costs nothing, and
 * catches the specs that are wrong on their face — before you pay for data or
 * rendering. Rejections come back with a reason so judgment gets one retry
 * with the problem named.
 */

import type { AwarenessPacket, ListSpec } from "../types.js";

export interface GateResult {
  ok: boolean;
  reason?: string;
}

export function checkFeasible(
  spec: ListSpec,
  packet: AwarenessPacket,
): GateResult {
  const org = packet.orgs.find((o) => o.slug === spec.orgSlug);
  if (!org) return { ok: false, reason: `org "${spec.orgSlug}" is not available today` };

  const missing = spec.platforms.filter((p) => !org.platforms.includes(p));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `org "${spec.orgSlug}" has no ${missing.join(", ")} data (has: ${org.platforms.join(", ")})`,
    };
  }

  if (spec.topN > org.entityCount) {
    return {
      ok: false,
      reason: `asked for top ${spec.topN} but only ${org.entityCount} entities are tracked`,
    };
  }

  if (spec.metric === "followers" && spec.dateRange !== null) {
    return { ok: false, reason: "followers is point-in-time; dateRange must be null" };
  }

  if (spec.metric === "emv") {
    if (!spec.dateRange) {
      return { ok: false, reason: "emv requires a dateRange" };
    }
    if (org.freshestDataDate && spec.dateRange.end > org.freshestDataDate) {
      return {
        ok: false,
        reason: `dateRange ends ${spec.dateRange.end} but data only runs to ${org.freshestDataDate}`,
      };
    }
    if (spec.dateRange.start > spec.dateRange.end) {
      return { ok: false, reason: "dateRange start is after end" };
    }
  }

  // Don't post the same org two days running.
  const yesterday = packet.recentPosts[0];
  if (yesterday && yesterday.orgSlug === spec.orgSlug && yesterday.date === lastDay(packet.today)) {
    return { ok: false, reason: `posted about "${spec.orgSlug}" yesterday; pick a different org` };
  }

  return { ok: true };
}

function lastDay(iso: string): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
