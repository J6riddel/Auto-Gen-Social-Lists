import { z } from "zod";

/** ---- Config shapes ---- */

export interface OrgConfig {
  slug: string;
  label: string;
  keyEnv: string;
  entityKind: string;
  expectedEntityCount: number;
  notes: string;
  /** The org's own umbrella account (e.g. a league's own account), if it has
   *  one — tracked alongside individual entities but not a peer of them.
   *  null for orgs with no such account (e.g. creators). */
  ownAccountName: string | null;
  /** Entities confirmed to not belong in this org's data at all (wrong-sport
   *  rows, misfiled test accounts) — a known Socialpruf-side data bug, not a
   *  per-list judgment call. Always dropped, unlike ownAccountName which is
   *  conditional on spec.excludeOwnAccount. Empty for orgs with no known bad
   *  rows. */
  excludeEntityNames: string[];
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
    ownAccountName: string | null;
  }>;
  metrics: MetricConfig[];
  recentPosts: Array<{ date: string; title: string; orgSlug: string }>;
}

/** ---- Judgment output ---- */

export const ListSpecSchema = z.object({
  reasoning: z
    .string()
    .max(500)
    .describe(
      "Brief, plain-text deliberation written before the fields below: what the " +
        "packet supports, why this org/angle over the alternatives, any coverage " +
        "or platform-count tradeoff considered. Kept in the receipt for audit, " +
        "never shown on the card.",
    ),
  title: z.string().min(4).max(70),
  orgSlug: z.string(),
  platforms: z
    .array(z.string())
    .min(1)
    .max(4)
    .refine((p) => p.length === 1 || p.length >= 3, {
      message: "platforms must be exactly 1, or a consistent mix of 3-4 — never 2",
    })
    .describe(
      "Every entity in the ranking is summed across the same platform set. " +
        "config/taste.md's hard rule: one platform, or a 3-4 mix, never 2.",
    ),
  metric: z.enum(["followers", "emv"]),
  excludeOwnAccount: z
    .boolean()
    .describe(
      "Whether to drop the org's own umbrella account (packet.orgs[].ownAccountName, " +
        "e.g. a league's own account) from this specific ranking. Not a fixed rule — " +
        "it's a peer of nothing, so usually excluded from a ranking of individual " +
        "entities, but judge it per list. No-op if the org has no ownAccountName.",
    ),
  dateRange: z
    .object({ start: z.string(), end: z.string() })
    .nullable()
    .describe("null for point-in-time metrics like followers"),
  topN: z
    .number()
    .int()
    .min(4)
    .max(24)
    .refine((n) => n % 2 === 0, {
      message: "topN must be even — an odd count above the two-column threshold leaves a gap under the short column",
    }),
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
  logoUrl: string | null;
  /** Instagram avatar for the same brand, matched by name — tried by the
   *  renderer only if logoUrl fails (dead, or an unsupported format like the
   *  WebP TikTok sometimes serves). null if no match or already Instagram. */
  logoUrlFallback: string | null;
}

export interface RankedList {
  spec: ListSpec;
  rows: RankedRow[];
  queriedAt: string;
  rawQuery: Record<string, unknown>;
}
