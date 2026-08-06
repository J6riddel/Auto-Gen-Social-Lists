/**
 * Static primary brand colors for every team Socialpruf tracks, keyed per
 * league (not one flat table) because mascot names collide across leagues
 * with genuinely different colors — Rangers (NY blue vs Texas red), Kings
 * (LA black vs Sacramento purple), Jets (Winnipeg navy vs NY green),
 * Panthers (Florida red vs Carolina blue), Giants (NY blue vs SF orange).
 *
 * These replace pixel-extraction as the row accent for any team whose color
 * is already known. Extraction from a fetched logo/avatar (see card.tsx's
 * extractAccentColor) is fragile in ways confirmed on real Socialpruf-hosted
 * images — JPEG chroma noise faked a color on a near-white wordmark (the
 * Yankees), and a flat brand-color background outweighed the actual mark by
 * pixel count (the Red Sox's navy-background avatar out-voting its own red
 * sock logo) — and unnecessary when the color is public and static. Kept as
 * the fallback for anything not in these tables — today that's just the
 * "creators" org, which has no fixed roster to know colors for ahead of
 * time.
 *
 * A team with no real hue (Raiders, Spurs, Nets, White Sox, LA Kings — truly
 * black/white/silver identities) is left out on purpose so it falls through
 * to extraction/null/the default palette instead of a fabricated color.
 *
 * One recognizable primary accent per team, not a full style-guide palette
 * — that's all a single-color gradient fill needs. Sourced from widely-cited
 * team brand colors rather than an official per-league API; worth
 * spot-checking if a specific team looks off.
 */

import { canonicalTeamKey } from "../teamNames.js";

const NHL_TEAM_COLORS: Record<string, string> = {
  ducks: "#F47A38",
  coyotes: "#8C2633",
  bruins: "#FFB81C",
  sabres: "#002654",
  flames: "#C8102E",
  hurricanes: "#CC0000",
  blackhawks: "#CF0A2C",
  avalanche: "#6F263D",
  "blue jackets": "#002654",
  stars: "#006847",
  "red wings": "#CE1126",
  oilers: "#FF4C00",
  panthers: "#C8102E",
  wild: "#154734",
  canadiens: "#AF1E2D",
  predators: "#FFB81C",
  devils: "#CE1126",
  islanders: "#00539B",
  rangers: "#0038A8",
  senators: "#C8102E",
  flyers: "#F74902",
  penguins: "#FCB514",
  sharks: "#006D75",
  kraken: "#99D9D9",
  blues: "#002F87",
  lightning: "#002868",
  "maple leafs": "#00205B",
  "hockey club": "#71AFE5",
  mammoth: "#6CACE4",
  canucks: "#00843D",
  "golden knights": "#B4975A",
  capitals: "#C8102E",
  jets: "#041E42",
};

const NFL_TEAM_COLORS: Record<string, string> = {
  cardinals: "#97233F",
  falcons: "#A71930",
  ravens: "#241773",
  bills: "#00338D",
  panthers: "#0085CA",
  bears: "#C83803",
  bengals: "#FB4F14",
  browns: "#FF3C00",
  cowboys: "#003594",
  broncos: "#FB4F14",
  lions: "#0076B6",
  packers: "#203731",
  texans: "#03202F",
  colts: "#002C5F",
  jaguars: "#006778",
  chiefs: "#E31837",
  chargers: "#0080C6",
  rams: "#003594",
  dolphins: "#008E97",
  vikings: "#4F2683",
  patriots: "#002244",
  saints: "#D3BC8D",
  giants: "#0B2265",
  jets: "#125740",
  eagles: "#004C54",
  steelers: "#FFB612",
  "49ers": "#AA0000",
  seahawks: "#69BE28",
  buccaneers: "#D50A0A",
  titans: "#4B92DB",
  commanders: "#5A1414",
};

const NBA_TEAM_COLORS: Record<string, string> = {
  hawks: "#E03A3E",
  celtics: "#007A33",
  hornets: "#1D1160",
  bulls: "#CE1141",
  cavaliers: "#6F263D",
  mavericks: "#00538C",
  nuggets: "#FEC524",
  pistons: "#C8102E",
  warriors: "#1D428A",
  rockets: "#CE1141",
  pacers: "#FDBB30",
  clippers: "#C8102E",
  lakers: "#552583",
  grizzlies: "#5D76A9",
  heat: "#98002E",
  bucks: "#00471B",
  timberwolves: "#236192",
  pelicans: "#0C2340",
  knicks: "#006BB6",
  thunder: "#007AC1",
  magic: "#0077C0",
  "76ers": "#006BB6",
  suns: "#E56020",
  "trail blazers": "#E03A3E",
  kings: "#5A2D81",
  raptors: "#CE1141",
  jazz: "#F9A01B",
  wizards: "#E31837",
};

const MLB_TEAM_COLORS: Record<string, string> = {
  diamondbacks: "#A71930",
  braves: "#CE1141",
  orioles: "#DF4601",
  "red sox": "#BD3039",
  cubs: "#0E3386",
  reds: "#C6011F",
  guardians: "#0C2340",
  rockies: "#333366",
  tigers: "#0C2340",
  astros: "#EB6E1F",
  royals: "#004687",
  angels: "#BA0021",
  dodgers: "#005A9C",
  marlins: "#00A3E0",
  brewers: "#12284B",
  twins: "#002B5C",
  mets: "#002D72",
  yankees: "#132448",
  athletics: "#003831",
  phillies: "#E81828",
  pirates: "#FDB827",
  padres: "#FFC425",
  giants: "#FD5A1E",
  mariners: "#0C2C56",
  cardinals: "#C41E3A",
  rays: "#092C5C",
  rangers: "#C0111F",
  "blue jays": "#134A8E",
  nationals: "#AB0003",
};

// Keyed by config/orgs.json's org slug, not a bare "nhl"/"nfl"/... league
// name — that's the only identifier card.tsx already has in hand per row
// (list.spec.orgSlug), and it's a 1:1 mapping today (one org per league).
const LEAGUE_COLOR_TABLES: Partial<Record<string, Record<string, string>>> = {
  "nhl-league": NHL_TEAM_COLORS,
  "nfl-league": NFL_TEAM_COLORS,
  "nba-league": NBA_TEAM_COLORS,
  "mlb-league": MLB_TEAM_COLORS,
};

/** Null for an org with no static table (the "creators" org — no fixed
 *  roster to know colors for ahead of time) or a team not in that league's
 *  table (a genuinely monochrome identity, left out on purpose). Callers
 *  fall back to logo pixel-extraction in either case. */
export function getStaticTeamColor(orgSlug: string, name: string): string | null {
  const table = LEAGUE_COLOR_TABLES[orgSlug];
  if (!table) return null;
  return table[canonicalTeamKey(name)] ?? null;
}
