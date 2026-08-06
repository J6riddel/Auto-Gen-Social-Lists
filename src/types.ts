import { z } from "zod";

/** ---- Config shapes ---- */

export interface OrgConfig {
  slug: string;
  label: string;
  keyEnv: string;
  entityKind: string;
  expectedEntityCount: number;
  notes: string;
}

export interface MetricConfig {
  id: string;
  label: string;
  unit: "count" | "usd" | "percent";
  cadence: string;
  caveat: string;
}

/** ---- Awareness ---- */

/** What we actually observed about an org, live. */
export interface OrgCoverage {
  slug: string;
  reachable: boolean;
  entityCount: number;
  platforms: string[];
  freshestDataDate: string | null; // ISO date
  gaps: string[];
}

/** The compact packet handed to the reasoner. Keep this small on purpose —
 *  it is the whole reason the judgment call costs cents. */
export interface AwarenessPacket {
  today: string;
  orgs: Array<{
    slug: string;
    label: string;
    entityKind: string;
    entityCount: number;
    platforms: string[];
    freshestDataDate: string | null;
    gaps: string[];
  }>;
  metrics: MetricConfig[];
  recentPosts: Array<{ date: string; title: string; orgSlug: string }>;
}

/** ---- Judgment output ---- */

export const ListSpecSchema = z.object({
  title: z.string().min(4).max(70),
  orgSlug: z.string(),
  platform: z.string(),
  metric: z.enum(["followers", "emv"]),
  dateRange: z
    .object({ start: z.string(), end: z.string() })
    .nullable()
    .describe("null for point-in-time metrics like followers"),
  topN: z.number().int().min(3).max(25),
  sortDir: z.enum(["desc", "asc"]),
  angle: z.string().max(280).describe("Why this list is worth posting"),
  caveat: z
    .string()
    .max(120)
    .nullable()
    .describe("Shown on the card footer if present"),
});

export type ListSpec = z.infer<typeof ListSpecSchema>;

/** ---- Fetch output ---- */

export interface RankedRow {
  entityId: string;
  name: string;
  handle: string | null;
  value: number;
}

export interface RankedList {
  spec: ListSpec;
  rows: RankedRow[];
  queriedAt: string;
  rawQuery: Record<string, unknown>;
}
