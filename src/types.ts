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
  /** ESPN's sport/league path (e.g. "football/nfl"), used to pull that
   *  league's live team roster and drop any fetched entity that isn't on it —
   *  see src/fetch/leagueRoster.ts. null for orgs with no such league (e.g.
   *  creators), which skips the check entirely. */
  espnLeaguePath: string | null;
  /** ESPN conference id, for an org that is one conference inside a larger
   *  ESPN league — all four Power Four orgs share espnLeaguePath
   *  "football/college-football" and differ only here. The roster check
   *  narrows to this conference, which is what lets several conference orgs
   *  read one Socialpruf workspace and still each rank only their own teams.
   *  null means the org is the whole league (every pro org today). */
  espnGroupId: number | null;
  /** Which half of a team's name identifies it on the card. "mascot" is right
   *  for the pro leagues, where the mascot is unique league-wide and is what a
   *  fan says ("Blackhawks"). "school" is required for college, where three
   *  SEC programs are all "Tigers" — the school is the identity, so a row
   *  reads "ALABAMA", not "CRIMSON TIDE". Also decides which name forms the
   *  roster check accepts; see leagueRoster.ts. */
  nameStyle: "mascot" | "school";
  /** Which orgs this one's entities may be pooled with in a single ranking.
   *  Two orgs share a family when an individual entity from one is a fair
   *  peer of an individual entity from the other — the four Power Four
   *  conferences are all "college-football", so a 24-row list spanning every
   *  Power Four program is one comparison. The pro leagues each stand alone:
   *  an NFL club and an NHL club are not peers on a per-post metric, because
   *  season length and posting cadence differ more than the clubs do.
   *  Only constrains rowKind "entity" lists — a rowKind "org" list compares
   *  whole orgs to each other, where every row is the same kind of total and
   *  crossing families is the point. */
  family: string;
  /** How many entities this org can actually rank, when that differs from
   *  what the probe can see. The probe counts social accounts, not entities
   *  (nhl-league: 132 accounts = 33 entities x 4 platforms), and a conference
   *  org sharing a workspace sees every conference's accounts. Set it and the
   *  feasibility gate caps topN against the real roster instead of an account
   *  count, so judgment can't propose a 20-team SEC list that verify would
   *  then fail. null keeps the probed count. */
  rosterSize: number | null;
}

export interface MetricConfig {
  id: string;
  label: string;
  unit: "count" | "usd" | "percent";
  cadence: string;
  caveat: string;
  /** Field name inside statsByEntity's `metrics` object (e.g. "engagementRate",
   *  "newFollowers") — lets fetch/client.ts pull any Socialpruf stat off the
   *  same brand-grouped row without per-metric fetch code. */
  apiField: string;
  /** true = current-value snapshot, dateRange must be null (e.g. followers).
   *  false = summed/computed over a window, dateRange required (e.g. emv,
   *  engagement rate, follower growth). */
  pointInTime: boolean;
  /** Most metrics failing verify's non-negative check means bad data. Growth
   *  metrics (new_followers) are the exception — a real, provable follower
   *  loss is a negative number, not an error. */
  allowNegative: boolean;
  /** Where the number physically comes from, which the card states under its
   *  title. "posts" = summed from individual posts (emv, likes); "accounts" =
   *  read off the account itself (followers, new_followers). Declared here
   *  rather than inferred from `cadence` or `pointInTime` because neither one
   *  answers it: new_followers is windowed like emv but no post produces it,
   *  and saying "collected across every post" of it would put a false
   *  methodology claim on the card. */
  sourceBasis: "posts" | "accounts";
  /** Whether entity values can be added together to describe the whole org,
   *  which is what a rowKind "org" row is. Counts and currency add up; a rate
   *  does not — summing sixteen engagement rates produces a number that isn't
   *  a rate at all, and the weighted average that would be correct needs
   *  denominators statsByEntity doesn't return. Declared rather than inferred
   *  from `unit`, for the same reason sourceBasis is: a future ratio metric
   *  (EMV per post) would be unit "usd" and still not summable. */
  aggregable: boolean;
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
    /** Orgs sharing a family may be pooled into one entity ranking. */
    family: string;
    entityCount: number;
    platforms: string[];
    /** Named ESPN subgroups this org can be narrowed to (divisions, or the
     *  conferences inside a whole league). Empty when the org has no ESPN
     *  league mapped or ESPN reported none. */
    subgroups: string[];
    freshestDataDate: string | null;
    gaps: string[];
    ownAccountName: string | null;
  }>;
  metrics: MetricConfig[];
  recentPosts: Array<{
    date: string;
    title: string;
    orgSlugs: string[];
    metric: string;
    platforms: string[];
  }>;
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
  orgSlugs: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe(
      "The universe this list ranks. One org is the common case. Several orgs " +
        "either pool their entities into one ranking (rowKind 'entity', and " +
        "they must all share a family) or become the rows themselves " +
        "(rowKind 'org').",
    ),
  rowKind: z
    .enum(["entity", "org"])
    .describe(
      "What one row is. 'entity' ranks the individual teams/creators inside " +
        "the orgs. 'org' ranks whole orgs against each other, each row being " +
        "that org's total — which needs an aggregable metric and exactly as " +
        "many rows as orgs.",
    ),
  subgroup: z
    .string()
    .nullable()
    .describe(
      "Narrows a single org to one of its ESPN subgroups by name (a division " +
        "or conference, e.g. 'AFC East') — must be one of that org's " +
        "packet.orgs[].subgroups. null for the whole org. Only valid with " +
        "exactly one orgSlug and rowKind 'entity'.",
    ),
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
  metric: z
    .string()
    .min(1)
    .describe(
      "Must be one of packet.metrics[].id. Not a fixed enum — the packet's " +
        "metrics catalog is the source of truth for what's available; the " +
        "feasibility gate checks membership and the point-in-time/dateRange rule.",
    ),
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
    .describe(
      "Framing the numbers need to be read honestly. Goes to the caption writer " +
        "for the post copy, not onto the card — the card's own line under the " +
        "title states the platforms and window and is generated deterministically.",
    ),
});

export type ListSpec = z.infer<typeof ListSpecSchema>;

/** ---- Fetch output ---- */

export interface RankedRow {
  entityId: string;
  /** Which org this row came from. Required because a pooled list holds rows
   *  from several orgs at once, and almost every render-time lookup (ESPN
   *  index, static color table, short name) is only unambiguous when scoped to
   *  one league — "Panthers" is a real team in both the NHL and the NFL. For a
   *  rowKind "org" row this is the org the row *is*. */
  orgSlug: string;
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
