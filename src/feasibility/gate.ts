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
  const orgs = [];
  for (const slug of spec.orgSlugs) {
    const found = packet.orgs.find((o) => o.slug === slug);
    if (!found) return { ok: false, reason: `org "${slug}" is not available today` };
    orgs.push(found);
  }

  if (new Set(spec.orgSlugs).size !== spec.orgSlugs.length) {
    return { ok: false, reason: "orgSlugs contains the same org twice" };
  }

  // Every org has to carry every requested platform. A platform present for
  // some orgs and absent for others would make the rows mean different things
  // — the same failure the never-two-platforms rule exists to prevent, one
  // level up.
  for (const org of orgs) {
    const missing = spec.platforms.filter((p) => !org.platforms.includes(p));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `org "${org.slug}" has no ${missing.join(", ")} data (has: ${org.platforms.join(", ")})`,
      };
    }
  }

  if (spec.rowKind === "org") {
    if (spec.orgSlugs.length !== spec.topN) {
      return {
        ok: false,
        reason: `a rowKind "org" list has one row per org: topN is ${spec.topN} but ${spec.orgSlugs.length} orgs were given`,
      };
    }
    if (spec.subgroup !== null) {
      return { ok: false, reason: 'subgroup cannot be combined with rowKind "org"' };
    }
  } else {
    // Pooling individual entities across orgs is only a fair comparison
    // inside one family — see OrgConfig.family.
    const families = [...new Set(orgs.map((o) => o.family))];
    if (families.length > 1) {
      return {
        ok: false,
        reason: `cannot pool entities across families (${families.join(", ")}); use rowKind "org" to compare them, or pick orgs from one family`,
      };
    }

    if (spec.subgroup !== null) {
      if (spec.orgSlugs.length !== 1) {
        return { ok: false, reason: "subgroup requires exactly one org" };
      }
      const org = orgs[0]!;
      if (!org.subgroups.includes(spec.subgroup)) {
        return {
          ok: false,
          reason: org.subgroups.length
            ? `"${spec.subgroup}" is not a subgroup of ${org.slug} (has: ${org.subgroups.join(", ")})`
            : `org "${org.slug}" offers no subgroups`,
        };
      }
    }

    // Capacity is the pooled roster, except when a subgroup narrows it — and
    // there the true size isn't known until ESPN is asked, so verify's exact
    // row-count check is what ultimately catches an over-large subgroup list.
    const capacity = orgs.reduce((n, o) => n + o.entityCount, 0);
    if (spec.topN > capacity) {
      return {
        ok: false,
        reason: `asked for top ${spec.topN} but only ${capacity} entities are tracked across ${spec.orgSlugs.join(", ")}`,
      };
    }
  }

  const metric = packet.metrics.find((m) => m.id === spec.metric);
  if (!metric) {
    return {
      ok: false,
      reason: `metric "${spec.metric}" is not available (packet.metrics: ${packet.metrics.map((m) => m.id).join(", ")})`,
    };
  }

  if (spec.rowKind === "org" && !metric.aggregable) {
    return {
      ok: false,
      reason: `${metric.id} cannot be summed into an org total (${metric.unit}); pick an aggregable metric for a rowKind "org" list`,
    };
  }

  if (metric.pointInTime && spec.dateRange !== null) {
    return { ok: false, reason: `${metric.id} is point-in-time; dateRange must be null` };
  }

  if (!metric.pointInTime) {
    if (!spec.dateRange) {
      return { ok: false, reason: `${metric.id} requires a dateRange` };
    }
    // The window has to be covered by every org in the list, so the freshest
    // date that matters is the *oldest* of them.
    const freshest = orgs
      .map((o) => o.freshestDataDate)
      .filter((d): d is string => Boolean(d))
      .sort()[0];
    if (freshest && spec.dateRange.end > freshest) {
      return {
        ok: false,
        reason: `dateRange ends ${spec.dateRange.end} but data only runs to ${freshest}`,
      };
    }
    if (spec.dateRange.start > spec.dateRange.end) {
      return { ok: false, reason: "dateRange start is after end" };
    }
  }

  // Don't cover the same ground two days running. Any overlap counts: a list
  // that pools the SEC in with three other conferences is still another SEC
  // post to anyone reading the feed.
  const yesterday = packet.recentPosts[0];
  if (yesterday && yesterday.date === lastDay(packet.today)) {
    const repeated = spec.orgSlugs.filter((s) => yesterday.orgSlugs.includes(s));
    if (repeated.length > 0) {
      return {
        ok: false,
        reason: `posted about "${repeated.join(", ")}" yesterday; pick different orgs`,
      };
    }
  }

  return { ok: true };
}

function lastDay(iso: string): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
