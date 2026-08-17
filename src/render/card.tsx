/**
 * Card renderer. Satori (JSX -> SVG) then resvg (SVG -> PNG). No browser, no
 * headless Chromium in CI, ~200ms.
 *
 * Satori supports a flexbox subset only — no grid, no float, every element
 * needs an explicit display. For a ranked list that is plenty.
 *
 * This is programmatic rendering, not image generation. The numbers on the card
 * are the numbers the API returned, which is the point.
 */

import { readFile } from "node:fs/promises";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import Jimp from "jimp";
import { tokens as t } from "./tokens.js";
import { getStaticTeamColor } from "./teamColors.js";
import {
  fetchLeaderHeadshotUrl,
  loadEspnLeagues,
  loadOrgMarkUrl,
  lookupEspnTeam,
  type EspnLeague,
} from "./espnAssets.js";
import { getMetric } from "../fetch/keyring.js";
import type { ListSpec, MetricConfig, RankedList, RankedRow } from "../types.js";
// Mascot-only short names for the row label (Chicago Blackhawks -> Blackhawks).
// Shared with fetch/client.ts, which uses the same table to join a
// brand-grouped entity name to an Instagram-grouped one when the two queries
// don't agree on full-vs-short form for the same team.
import { displayTeamName as displayName } from "../teamNames.js";

/** Driven by the metric's `unit`/`allowNegative` (config/orgs.json), not a
 *  hardcoded metric id — a new metric added to the catalog formats correctly
 *  here with no card.tsx change. A "+" prefix on a positive allowNegative
 *  value (new_followers) makes clear it's a delta, not an absolute count;
 *  negative values already print their own "-" via toLocaleString. */
function formatValue(value: number, metric: MetricConfig): string {
  if (metric.unit === "usd") {
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }
  if (metric.unit === "percent") {
    return `${value.toFixed(1)}%`;
  }
  const sign = metric.allowNegative && value > 0 ? "+" : "";
  return `${sign}${Math.round(value).toLocaleString("en-US")}`;
}

// Confirmed against real data: Socialpruf re-hosts logos in whatever format
// the source platform used, and that's WebP for at least some TikTok avatars.
// Satori has no WebP support in <img> — not a soft failure, it throws deep in
// its layout code ("a is not iterable") and takes the whole render down with
// it. JPEG and PNG are confirmed working; anything else is treated the same
// as a dead URL rather than risking another unsupported format crashing a
// real run.
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

/** Satori can't fetch remote images itself in Node, so every logo has to be
 *  fetched and inlined as a data URI before the tree is handed to it. A slow,
 *  dead, or unsupported-format URL degrades to "no logo" for that one row,
 *  never fails the whole card — logos are decoration, not a claim the card
 *  is making. */
async function fetchImage(url: string): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!SUPPORTED_IMAGE_TYPES.has(contentType)) return null;
    const data = Buffer.from(await res.arrayBuffer());
    return { data, contentType };
  } catch {
    return null;
  }
}

function toDataUri(image: { data: Buffer; contentType: string } | null): string | null {
  return image ? `data:${image.contentType};base64,${image.data.toString("base64")}` : null;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** Below this saturation a color has no hue worth preserving, and the hue
 *  channel of an almost-grey pixel is numerically meaningless — pure black
 *  reports hue 0, which is red. Forcing the saturation floor onto one of those
 *  invents a color the team does not have: confirmed on the White Sox, whose
 *  official #000000 came out of the floor as a mauve row. Teams with a
 *  genuinely achromatic identity (White Sox, Raiders, Spurs, Nets) are
 *  supposed to render as neutral steel, so they are routed around the floor
 *  instead of through it. */
const ACHROMATIC_S = 0.12;

/** Card background is near-black — a color pulled straight off a logo could
 *  easily be near-black or washed-out and unreadable there, so hue is kept
 *  as-extracted but lightness/saturation are floored before rendering. This is
 *  what makes it safe to use on arbitrary team colors without checking each
 *  one by hand. */
function toLegibleHex(r: number, g: number, b: number): string {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < ACHROMATIC_S) return hslToHex(0, 0, Math.max(l, 0.5));
  return hslToHex(h, Math.max(s, 0.35), Math.max(l, 0.5));
}

/** The row fill is a ramp built off the team's own color rather than a fixed
 *  pair of dark/light values, so a team whose brand color is already bright
 *  (Mets orange) stays bright and one that is genuinely dark (Dodgers navy)
 *  stays dark. Multiplying the base lightness keeps that relationship; setting
 *  absolute stops would flatten every team to the same perceived brightness
 *  and throw away the only thing making the rows distinguishable.
 *
 *  Saturation is floored so a near-grey brand color still reads as colored
 *  rather than as a broken row, and capped so it doesn't turn plastic. */
function rowRamp(hex: string): { dark: string; mid: string; light: string; chip: string } {
  const [h, rawS, rawL] = hexToHsl(hex);
  // An achromatic team keeps a trace of saturation rather than none — a truly
  // flat grey ramp reads as an unstyled row, a barely-tinted one reads as
  // deliberate steel. See ACHROMATIC_S.
  const s = rawS < ACHROMATIC_S ? 0.05 : Math.min(Math.max(rawS, 0.45), 0.95);
  const l = Math.min(Math.max(rawL, 0.22), 0.52);
  const at = (k: number) => hslToHex(h, s, Math.min(0.72, Math.max(0.06, l * k)));
  return { dark: at(0.5), mid: at(0.85), light: at(1.22), chip: at(0.34) };
}

/** Left-to-right ramp, matching the direction the eye reads the row: rank and
 *  name sit on the dark end, the value pill on the bright end. */
function rowGradient(hex: string): string {
  const { dark, mid, light } = rowRamp(hex);
  return `linear-gradient(90deg, ${dark} 0%, ${mid} 58%, ${light} 100%)`;
}

/** The photo cell behind a headshot. Steeper and darker than a row's ramp —
 *  it is a background for a cutout, not a surface carrying text, so it can go
 *  further toward black at the edges without costing legibility. */
function photoGradient(hex: string): string {
  const { dark, mid } = rowRamp(hex);
  return `linear-gradient(160deg, ${mid} 0%, ${dark} 62%, #0B0B0D 100%)`;
}

/** A static team color (see teamColors.ts) is the real brand hue but not
 *  necessarily legible on the card's dark background at full strength (e.g.
 *  Yankees navy) — routed through the same floor as an extracted color so
 *  both sources render consistently. */
function legibleHexFromHex(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return toLegibleHex((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

// Circular hue buckets, 30 degrees wide, centered on 0/30/60/... — the
// (h + half-width) % 360 shift is what makes red (which straddles the 0/360
// seam) land in one bucket instead of splitting across two.
const HUE_BUCKET_SIZE = 30;
const HUE_BUCKET_COUNT = 360 / HUE_BUCKET_SIZE;

/** Finds "the" brand color by picking the most-populated hue cluster in a
 *  downscaled logo, not a single outlier pixel — a cheap stand-in for real
 *  palette extraction that works well for sports logos (usually one or two
 *  vivid colors on a plain/transparent field). Near-white/near-black/gray/
 *  transparent pixels are skipped since they're almost always background,
 *  not the mark itself. Averaging within the winning bucket, rather than
 *  taking a single max-saturation pixel, matters in practice: flat-color
 *  logos are full of pixels tied at saturation 1.0 (e.g. a navy cap brim and
 *  a red sock are equally saturated), and picking the first one encountered
 *  in raster order picked the wrong team color on real logos — confirmed on
 *  the Red Sox and Braves crests, both of which extracted as navy blue
 *  despite red covering more than half the mark. Returns null (not a guess)
 *  when nothing qualifies, e.g. a monochrome logo — Row falls back to the
 *  default palette in that case, same as a missing logo. */
async function extractAccentColor(buf: Buffer): Promise<string | null> {
  try {
    const img = await Jimp.read(buf);
    img.resize(32, 32);
    const { data } = img.bitmap;

    const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      if (a < 128) continue;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lightness = (max + min) / 2 / 255;
      const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
      if (lightness > 0.92 || lightness < 0.08 || sat < 0.25) continue;

      const [h] = rgbToHsl(r, g, b);
      const bucket = Math.floor(((h + HUE_BUCKET_SIZE / 2) % 360) / HUE_BUCKET_SIZE) % HUE_BUCKET_COUNT;
      const entry = buckets.get(bucket) ?? { r: 0, g: 0, b: 0, n: 0 };
      entry.r += r;
      entry.g += g;
      entry.b += b;
      entry.n += 1;
      buckets.set(bucket, entry);
    }

    let winner: { r: number; g: number; b: number; n: number } | null = null;
    for (const entry of buckets.values()) if (!winner || entry.n > winner.n) winner = entry;
    if (!winner) return null;

    return toLegibleHex(
      Math.round(winner.r / winner.n),
      Math.round(winner.g / winner.n),
      Math.round(winner.b / winner.n),
    );
  } catch {
    return null;
  }
}

interface RowVisual {
  dataUri: string | null;
  accent: string | null;
  /** ESPN's mascot form when the row matched a real team, else null and the
   *  shared teamNames.ts table decides. */
  shortName: string | null;
}

/** A row is only identified by its org *and* id once a list can pool several
 *  orgs — see RankedRow.orgSlug. */
function rowKey(r: RankedRow): string {
  return `${r.orgSlug}:${r.entityId}`;
}

async function resolveVisuals(
  rows: RankedRow[],
  espnBySlug: Map<string, EspnLeague | null>,
  orgMarks: Map<string, string | null>,
): Promise<Map<string, RowVisual>> {
  const entries = await Promise.all(
    rows.map(async (r): Promise<[string, RowVisual]> => {
      const espn = espnBySlug.get(r.orgSlug) ?? null;
      // An org row is not a team and will never match a roster; its mark is
      // the conference crest, resolved once per org rather than per row.
      const orgMark = orgMarks.get(r.orgSlug) ?? null;
      const espnTeam = orgMark ? null : lookupEspnTeam(espn, r.name);

      // ESPN's mark first: it is the crest on transparency, which is what the
      // row's light logo panel is designed around. Socialpruf's avatar is a
      // square platform profile picture with its own background — a correct
      // image, but the wrong kind of image for this slot — so it stays as the
      // fallback rather than the primary. See espnAssets.ts.
      let image = orgMark ? await fetchImage(orgMark) : null;
      if (!image && espnTeam?.logoUrl) image = await fetchImage(espnTeam.logoUrl);
      if (!image && r.logoUrl) image = await fetchImage(r.logoUrl);
      // Primary failed (dead URL, or an unsupported format like TikTok's
      // WebP) — retry once against the same brand's Instagram avatar before
      // falling back to the placeholder. See build.ts's logoUrlFallback.
      if (!image && r.logoUrlFallback && r.logoUrlFallback !== r.logoUrl) {
        image = await fetchImage(r.logoUrlFallback);
      }

      // The hand-curated table outranks ESPN's `color`, which reports the
      // team's *first* official color rather than its most recognizable one —
      // it gives navy for the Red Sox and for the Tigers, both of which read
      // as the wrong team on a card. ESPN slots in behind it as the fallback
      // for teams the table deliberately omits (the achromatic identities:
      // White Sox, Raiders, Spurs, Nets), where #000000 is genuinely correct
      // and now renders as neutral steel rather than a fabricated hue. Pixel
      // extraction stays last, for orgs with no league at all.
      const knownColor = getStaticTeamColor(r.orgSlug, r.name) ?? espnTeam?.color ?? null;
      const accent = knownColor
        ? legibleHexFromHex(knownColor)
        : image
          ? await extractAccentColor(image.data)
          : null;

      return [
        rowKey(r),
        { dataUri: toDataUri(image), accent, shortName: espnTeam?.shortName ?? null },
      ];
    }),
  );
  return new Map(entries);
}

export interface FaceVisual {
  dataUri: string;
  accent: string;
}

/** Headshots for the photo panel: the statistical leader of each of the top
 *  entities. Two network hops per face (leaders, then the image), which is why
 *  it is scoped to the handful of rows the panel actually shows rather than
 *  the whole list. Any failure just means a shorter panel — see Card. */
async function resolveFaces(
  rows: RankedRow[],
  espnBySlug: Map<string, EspnLeague | null>,
  visuals: Map<string, RowVisual>,
): Promise<FaceVisual[]> {
  const today = new Date();

  const faces = await Promise.all(
    rows.slice(0, t.photo.cells).map(async (r): Promise<FaceVisual | null> => {
      // Each row's leader is looked up in its own league — an org row has no
      // roster to have a leader on, and resolves to nothing here.
      const espn = espnBySlug.get(r.orgSlug) ?? null;
      if (!espn) return null;
      const team = lookupEspnTeam(espn, r.name);
      if (!team) return null;
      const url = await fetchLeaderHeadshotUrl(espn, team.teamId, today);
      if (!url) return null;
      const dataUri = toDataUri(await fetchImage(url));
      if (!dataUri) return null;
      return { dataUri, accent: visuals.get(rowKey(r))?.accent ?? t.color.accent };
    }),
  );

  // Collapsed rather than gapped: a missing face for the #1 team should let
  // #2's photo take the space, not leave a hole where a photo was expected.
  return faces.filter((f): f is FaceVisual => f !== null);
}

/** Unlike row logos, the socialpruf mark is not decoration — every card must
 *  carry it. So it's a local asset read with the fonts (fails the whole
 *  render if missing) rather than a network fetch that degrades to nothing. */
async function loadBrandLogo(): Promise<string> {
  const buf = await readFile("fonts/pruf-logo.png");
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function clamp(v: number, [min, max]: [number, number]): number {
  return Math.min(max, Math.max(min, v));
}

/** Rough advance widths for Anton, as a fraction of font size. Only used to
 *  size the value pill — Satori will not measure text for us, and every value
 *  pill has to be the same width or the right edge of the card jitters row to
 *  row. Deliberately generous: over-estimating costs a few px of pill, while
 *  under-estimating clips a number, and a clipped number is a wrong number.
 *  "%" is padded well past its true advance on purpose: percent values are
 *  short, so a pill sized to their real width reads cramped next to the name
 *  pill. Don't "correct" it back to the measured glyph width. */
const ANTON_ADVANCE: Record<string, number> = { ",": 0.26, ".": 0.26, "%": 1.0, $: 0.5, "+": 0.5, "-": 0.32 };
const ANTON_DIGIT_ADVANCE = 0.48;

function estimateWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += ANTON_ADVANCE[ch] ?? ANTON_DIGIT_ADVANCE;
  return Math.ceil(em * fontSize);
}

/** Uppercase advances for Anton, same units as ANTON_ADVANCE. Only the
 *  outliers are listed — anything unlisted takes the default. */
const ANTON_CAP_ADVANCE: Record<string, number> = {
  I: 0.24, J: 0.36, L: 0.38, M: 0.66, W: 0.68, " ": 0.2,
  1: 0.34, ",": 0.24, ".": 0.24, "/": 0.32, "-": 0.3, "'": 0.2,
};
const ANTON_CAP_DEFAULT = 0.46;

/** Same units, for Inter. Not a nicety: Anton is condensed enough that its
 *  advances are ~two thirds of Inter's, so measuring an Inter line with the
 *  Anton table under-counts its wrapped lines — the one error direction that
 *  pushes the footer off the canvas (see ESTIMATE_SAFETY). */
const INTER_CAP_ADVANCE: Record<string, number> = {
  I: 0.3, J: 0.58, L: 0.6, M: 0.88, W: 0.92, " ": 0.28,
  1: 0.6, ",": 0.28, ".": 0.28, "/": 0.42, "-": 0.36, "'": 0.24,
};
const INTER_CAP_DEFAULT = 0.68;

/** A face as the line estimator sees it. `tracking` is in px, not em — it is
 *  a letterSpacing value copied from the style below, and Satori applies that
 *  per character on top of the advance. */
interface CapsFace {
  advance: Record<string, number>;
  fallback: number;
  tracking: number;
}
const ANTON_CAPS: CapsFace = { advance: ANTON_CAP_ADVANCE, fallback: ANTON_CAP_DEFAULT, tracking: 0 };
// The source line's letterSpacing is declared here rather than beside the rest
// of the header geometry so the estimate and the style read the same number —
// the JSX below sets letterSpacing from INTER_CAPS.tracking.
const INTER_CAPS: CapsFace = { advance: INTER_CAP_ADVANCE, fallback: INTER_CAP_DEFAULT, tracking: 1.2 };

/** Deliberately 8% over true width. This feeds the row-height budget, and the
 *  two error directions are not symmetric: over-estimating the line count
 *  makes rows slightly shorter and leaves a little slack above the footer,
 *  while under-estimating sizes rows for space the header is actually using
 *  and pushes the footer off the canvas. Biased toward the harmless one. */
const ESTIMATE_SAFETY = 1.08;

function estimateCapsWidth(text: string, fontSize: number, face: CapsFace = ANTON_CAPS): number {
  let em = 0;
  let chars = 0;
  for (const ch of text.toUpperCase()) {
    em += face.advance[ch] ?? face.fallback;
    chars++;
  }
  return (em * fontSize + chars * face.tracking) * ESTIMATE_SAFETY;
}

/** Greedy word wrap, matching what Satori will do with the same string, so the
 *  row list can be sized against the header this title will actually occupy
 *  rather than against the worst case every time. Without it a two-line title
 *  still reserved three lines' worth of space and left a visible band of dead
 *  canvas under the last row.
 *
 *  Returns the true count, uncapped. It used to clamp to the element's own
 *  maxLines, which made an overflowing title indistinguishable from one that
 *  exactly filled its box: the header math saw three lines and was satisfied
 *  while Satori's `overflow: hidden` quietly ate the fourth, and a headline
 *  cut mid-phrase went out on a real post. Callers that want the drawn height
 *  clamp it themselves; titleFitProblem needs the number that wasn't drawn. */
function estimateLines(
  text: string,
  fontSize: number,
  width: number,
  face: CapsFace = ANTON_CAPS,
): number {
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    const w = estimateCapsWidth(word, fontSize, face);
    const spaced = used === 0 ? w : used + estimateCapsWidth(" ", fontSize, face) + w;
    if (spaced > width && used > 0) {
      lines++;
      used = w;
    } else {
      used = spaced;
    }
  }
  return lines;
}

interface RowMetrics {
  rowH: number;
  rowGap: number;
  padX: number;
  rank: number;
  logoGap: number;
  name: number;
  value: number;
  /** Uniform across every row in a column — see estimateWidth. */
  valueW: number;
  rankChipW: number;
  logoPanelW: number;
}

/** Rows stretch or compress to exactly fill the fixed canvas regardless of
 *  row count, so a 3-row list never leaves a dead gap before the footer and
 *  a 25-row list never clips. Height/gap scale generously — extra height
 *  just becomes breathing room around vertically-centered row content — but
 *  type and logo size scale much less, so a short list reads as "roomy,"
 *  not "giant text." `visualRows` is the tallest column's row count: the
 *  full list in single-column mode, half of it in two-column mode. */
function computeRowMetrics(
  visualRows: number,
  skinny: boolean,
  values: string[],
  headerHeight: number,
  columnWidth: number,
): RowMetrics {
  const available = t.size.h - t.space.pad * 2 - headerHeight - t.layout.footerBudget;
  const rowUnit = available / visualRows;

  const base = skinny
    ? {
        rowH: t.spaceTwoCol.rowH,
        rowGap: t.spaceTwoCol.rowGap,
        padX: t.spaceTwoCol.padX,
        rank: t.typeTwoCol.rank,
        logoGap: 10,
        name: t.typeTwoCol.name,
        value: t.typeTwoCol.value,
      }
    : {
        rowH: t.space.rowH,
        rowGap: t.space.rowGap,
        padX: t.space.padX,
        rank: t.type.rank,
        logoGap: 16,
        name: t.type.name,
        value: t.type.value,
      };

  const baseUnit = base.rowH + base.rowGap;
  const heightScale = clamp(rowUnit / baseUnit, t.layout.heightScaleRange);
  const fontScale = clamp(rowUnit / baseUnit, t.layout.fontScaleRange);

  const value = Math.max(14, Math.round(base.value * fontScale));
  const widest = values.reduce((max, v) => Math.max(max, estimateWidth(v, value)), 0);

  const rowH = Math.round(base.rowH * heightScale);
  const logoGap = Math.round(base.logoGap * fontScale);
  const valueW = widest + base.padX * 2;
  const namePillW = columnWidth - valueW - logoGap;

  // The rank chip and logo panel are square-ish blocks keyed to row height, so
  // on a short list — where rows stretch to nearly double height to fill the
  // canvas — they grow sideways into space the team name needs, and a name
  // like SEAHAWKS starts to crowd. Capping them as a fraction of the pill's
  // own width is what keeps the proportions stable across row counts: they
  // track row height until that would cost the name its measure, then stop.
  const rankChipW = Math.round(Math.min(rowH * 0.78, namePillW * 0.15));
  const logoPanelW = Math.round(Math.min(rowH * 1.35, namePillW * 0.24));

  return {
    rowH,
    rankChipW,
    logoPanelW,
    valueW,
    rowGap: Math.max(2, Math.round(base.rowGap * heightScale)),
    padX: base.padX,
    rank: Math.max(12, Math.round(base.rank * fontScale)),
    logoGap,
    name: Math.max(14, Math.round(base.name * fontScale)),
    value,
  };
}

function Row({
  row,
  rank,
  metric,
  metrics,
  logoDataUri,
  accentColor,
  shortName,
}: {
  row: RankedRow;
  rank: number;
  metric: MetricConfig;
  metrics: RowMetrics;
  logoDataUri: string | null;
  accentColor: string | null;
  shortName: string | null;
}) {
  // Every row fills with a ramp built off the entity's own brand color (or
  // t.color.accent when a row has no logo/color to pull from — see
  // extractAccentColor). Row text is pinned to white regardless of that
  // fill's contrast pick.
  const baseHue = accentColor ?? t.color.accent;
  const ramp = rowRamp(baseHue);
  const gradient = rowGradient(baseHue);

  // Scaled off the row's own height, not a fixed pixel value, so the corner
  // reads the same proportionally whether rows are stretched tall (a short
  // list) or compact (two-column mode).
  const radius = Math.max(6, Math.round(metrics.rowH * 0.14));
  const borderWidth = Math.max(2, Math.round(metrics.rowH * 0.028));
  // Fits the panel with a margin on every side, so a wide mark (a wordmark
  // crest) and a tall one (a shield) both sit inside it rather than touching
  // the edges.
  const logoSize = Math.round(Math.min(metrics.rowH * 0.74, metrics.logoPanelW * 0.78));

  // Shared by the name pill and the value pill so the two read as one object
  // split in half rather than two unrelated shapes.
  const pillFrame = {
    display: "flex",
    alignItems: "center",
    height: metrics.rowH,
    backgroundImage: gradient,
    borderRadius: radius,
    borderWidth,
    borderStyle: "solid",
    borderColor: "rgba(255,255,255,0.82)",
    overflow: "hidden",
  } as const;

  return (
    <div
      key={row.entityId}
      style={{
        display: "flex",
        alignItems: "center",
        marginBottom: metrics.rowGap,
      }}
    >
      <div style={{ ...pillFrame, flexGrow: 1, minWidth: 0, marginRight: metrics.logoGap }}>
        {/* Rank sits in its own darker block at the head of the pill rather
            than floating over the logo — at two-column scale a number on top
            of a crest is unreadable, and the reference treatment reads as a
            table index, which is what it is. */}
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            width: metrics.rankChipW,
            height: metrics.rowH,
            backgroundColor: ramp.chip,
            fontFamily: t.font.display,
            fontSize: metrics.rank,
            color: "#FFFFFF",
          }}
        >
          {rank}
        </div>
        <div
          style={{
            display: "flex",
            flexGrow: 1,
            minWidth: 0, // without this a flex item won't shrink past its content
            // width, so long names can run straight into the logo panel with
            // zero gap — confirmed happening on real team names before this fix.
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            paddingLeft: metrics.padX,
            paddingRight: metrics.padX,
            fontFamily: t.font.display,
            fontSize: metrics.name,
            color: "#FFFFFF",
          }}
        >
          {(shortName ?? displayName(row.name)).toUpperCase()}
        </div>
        {/* Light panel so a full-color crest on transparency reads the same
            for every team. Drawn even when the logo is missing, so the pill's
            right edge stays consistent down the column. */}
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            width: metrics.logoPanelW,
            height: metrics.rowH,
            backgroundColor: t.color.logoPanel,
          }}
        >
          {logoDataUri ? (
            <img
              src={logoDataUri}
              width={logoSize}
              height={logoSize}
              style={{ width: logoSize, height: logoSize, objectFit: "contain" }}
            />
          ) : null}
        </div>
      </div>
      <div
        style={{
          ...pillFrame,
          flexShrink: 0, // name already yields via minWidth:0 + ellipsis above;
          // pinning this to its computed width is what stops a long name from
          // squeezing the number itself off the row.
          justifyContent: "center",
          width: metrics.valueW,
          fontFamily: t.font.display,
          fontSize: metrics.value,
          color: "#FFFFFF",
        }}
      >
        {formatValue(row.value, metric)}
      </div>
    </div>
  );
}

// Header geometry, shared by the JSX below and by the height estimate that
// sizes the row list. Kept as constants rather than inlined in both places
// because the two have to agree — if the render used one leading and the
// estimate another, rows would be sized against a header that doesn't exist.
export const TITLE_MAX_LINES = 3;

/** The measure the headline actually gets, which the row count decides. Two
 *  columns fill the canvas so the title gets the whole width; a single-column
 *  list gives roughly a third of it to the photo panel and the headline has to
 *  fit what's left — barely half the room, for the same three lines.
 *
 *  Assumes the photo panel is there whenever the layout allows it, even though
 *  it only appears if ESPN returned a headshot, which isn't known until fetch.
 *  The two errors aren't symmetric: assuming photos and being wrong costs a
 *  slightly shorter title than necessary, while assuming none and being wrong
 *  clips a headline on a card that has already gone out. */
function headlineWidth(rowCount: number): number {
  const twoColumn = rowCount >= t.layout.twoColumnThreshold;
  // Mirrors Card's own photoW, deliberately — if these two ever disagree the
  // check is measuring a card that isn't the one being drawn.
  const photoW = twoColumn ? 0 : Math.round(t.size.w * t.photo.widthRatio);
  return t.size.w - t.space.pad * 2 - photoW;
}

/** Roughly how many characters fit the headline box at this layout, for the
 *  prompt and the schema to aim at. Necessarily approximate — Anton's caps run
 *  from 0.24em (I) to 0.68em (W), so no character count is exact — which is why
 *  titleFitProblem measures the real string rather than trusting this. Derived
 *  from the titles in history/ rather than picked: every one of them fits at or
 *  under these lengths, and the first that don't appear just above. */
export function titleCharBudget(rowCount: number): number {
  return rowCount >= t.layout.twoColumnThreshold ? 55 : 31;
}

/** Why this title won't fit the card, or null if it will.
 *
 *  The headline box is capped at TITLE_MAX_LINES with `overflow: hidden`, and
 *  that combination fails silently — a fourth line isn't an error, it is simply
 *  absent, so the card renders, verifies, and posts with its headline cut
 *  mid-phrase. This is what turns that into a rejection the feasibility gate
 *  can hand back to judgment while a retry is still free. */
export function titleFitProblem(title: string, rowCount: number): string | null {
  const lines = estimateLines(title, t.type.title, headlineWidth(rowCount));
  if (lines <= TITLE_MAX_LINES) return null;
  return (
    `title is ${title.length} characters and wraps to ${lines} lines; the card ` +
    `shows ${TITLE_MAX_LINES} and silently clips the rest, so a ${rowCount}-row ` +
    `list needs about ${titleCharBudget(rowCount)} characters or fewer`
  );
}

// Three, not two, purely as insurance. The worst realistic source line (a
// 4-platform post-basis one) measures to two lines even in single-column mode,
// where the photo panel leaves the header its narrowest measure — the third is
// there so a bad estimate wraps instead of clipping mid-sentence. The header
// budget in tokens.ts covers all three, so it costs nothing when unused.
const SOURCE_MAX_LINES = 3;
// Anton's caps are tall and its default leading leaves a visible band of air
// between lines; tightening it is what makes a multi-line headline read as one
// block. Not tighter than this: at 0.92 a comma on one line descended into the
// caps of the next, which reads as a rendering artifact rather than as style.
const TITLE_LEADING = 1.05;
const SOURCE_LEADING = 1.3;
const SOURCE_GAP = 12;
const HEADER_MARGIN = 30;

function footerLine(list: RankedList): string {
  const { spec } = list;
  const range = spec.dateRange
    ? `${spec.dateRange.start} to ${spec.dateRange.end}`
    : `as of ${list.queriedAt.slice(0, 10)}`;
  // No "socialpruf" text prefix — the wordmark image sitting right next to
  // this line already carries that. No platform list either: the source line
  // under the title now names the platforms in full, and repeating them here
  // as slugs made the card state its inputs twice in two different vocabularies.
  return range;
}

/** Display names for the platform slugs Socialpruf returns. A slug that isn't
 *  listed falls back to capitalizing itself rather than throwing — a new
 *  platform appearing upstream should read slightly plain on one card, not
 *  fail a run that has already been paid for. */
const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "X",
  x: "X",
  youtube: "YouTube",
  snapchat: "Snapchat",
  facebook: "Facebook",
};

/** Canonical reading order, so the same platform mix always renders in the
 *  same order regardless of what order judgment happened to list it in. */
const PLATFORM_ORDER = ["instagram", "tiktok", "twitter", "x", "youtube", "snapchat", "facebook"];

function platformLabel(slug: string): string {
  return PLATFORM_LABELS[slug.toLowerCase()] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** "Instagram, TikTok, X and YouTube" — an Oxford-comma-free list, because the
 *  line is set in caps and a trailing comma before "and" reads as noise there. */
function platformPhrase(platforms: string[]): string {
  const labels = [...platforms]
    .sort((a, b) => {
      const ai = PLATFORM_ORDER.indexOf(a.toLowerCase());
      const bi = PLATFORM_ORDER.indexOf(b.toLowerCase());
      return (ai === -1 ? PLATFORM_ORDER.length : ai) - (bi === -1 ? PLATFORM_ORDER.length : bi);
    })
    .map(platformLabel);
  // Dedupe after labelling, not before — "twitter" and "x" are two slugs for
  // one platform and must not produce "X and X".
  const unique = [...new Set(labels)];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/** The provenance line under the title. Deterministic — it restates the spec's
 *  own inputs, so it cannot drift from what was actually fetched the way a
 *  written caveat could.
 *
 *  The wording forks on the metric's basis because "collected across every
 *  post" is a claim, not decoration: it is true of emv or likes, which really
 *  are summed over posts, and false of followers or new_followers, which are
 *  account-level counts no post contributes to. Getting that wrong would put a
 *  false methodology statement on the face of a card whose whole argument is
 *  that it shows its methodology. */
function sourceLine(spec: ListSpec, metric: MetricConfig): string {
  const where = platformPhrase(spec.platforms);
  return metric.sourceBasis === "posts"
    ? `Collected across every post on ${where}`
    : `${metric.label} tracked on ${where}`;
}

/** Faint diagonal streaks over the background, the way a broadcast graphic
 *  bed is lit. Rotated bars rather than a repeating-linear-gradient because
 *  Satori implements the plain gradient functions only. Purely atmospheric —
 *  every one of these is under 4% opacity. */
function BackgroundTexture() {
  const bars = [-140, 40, 260, 520, 760, 1010];
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        top: 0,
        left: 0,
        width: t.size.w,
        height: t.size.h,
        overflow: "hidden",
      }}
    >
      {bars.map((left, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            position: "absolute",
            top: -400,
            left,
            width: i % 2 === 0 ? 120 : 46,
            height: t.size.h + 800,
            backgroundImage:
              "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.035) 45%, rgba(255,255,255,0) 100%)",
            transform: "rotate(18deg)",
          }}
        />
      ))}
    </div>
  );
}

/** Full-bleed column of headshots down the right edge. Absolutely positioned
 *  rather than a flex sibling so it can run past the card's padding to the
 *  canvas edge, which is what makes it read as photography rather than as
 *  another boxed element. */
function PhotoPanel({ faces, width }: { faces: FaceVisual[]; width: number }) {
  const cellH = Math.round(t.size.h / faces.length);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        top: 0,
        right: 0,
        width,
        height: t.size.h,
      }}
    >
      {faces.map((face, i) => {
        // The cutouts are head-and-shoulders on transparency with generous
        // empty margins, so they are drawn wider than the cell and bottom-
        // anchored: the head fills the slot and the surplus transparent
        // margin is what gets clipped, not the subject.
        const imgW = Math.round(width * 1.9);
        const imgH = Math.round(imgW * 0.73);
        return (
          <div
            key={i}
            style={{
              display: "flex",
              position: "relative",
              alignItems: "flex-end",
              justifyContent: "center",
              width,
              height: cellH,
              overflow: "hidden",
              backgroundImage: photoGradient(face.accent),
            }}
          >
            <img
              src={face.dataUri}
              width={imgW}
              height={imgH}
              style={{ width: imgW, height: imgH, objectFit: "contain" }}
            />
            {/* Seam softener where one cell meets the next, and where the
                panel meets the list column. Without it the two photos read as
                two pasted rectangles. */}
            <div
              style={{
                display: "flex",
                position: "absolute",
                top: 0,
                left: 0,
                width,
                height: cellH,
                backgroundImage:
                  "linear-gradient(90deg, rgba(11,11,13,0.75) 0%, rgba(11,11,13,0) 26%)",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function Card({
  list,
  visuals,
  faces,
  brandLogo,
}: {
  list: RankedList;
  visuals: Map<string, RowVisual>;
  faces: FaceVisual[];
  brandLogo: string;
}) {
  const { spec, rows } = list;
  const metric = getMetric(spec.metric);
  const twoColumn = rows.length >= t.layout.twoColumnThreshold;

  // The photo panel only exists in single-column mode. Two columns of rows
  // already consume the full measure, and stealing a third of the width for
  // photography would force team names into ellipsis — the list is the
  // deliverable, the photography is the frame around it.
  const showPhotos = !twoColumn && faces.length > 0;
  const photoW = showPhotos ? Math.round(t.size.w * t.photo.widthRatio) : 0;

  // Explicit width, not just flexGrow — Satori sizes a flex item to its
  // content first and only grows from there, so without a hard width a long
  // title can push past the canvas edge instead of wrapping inside it.
  const fullWidth = t.size.w - t.space.pad * 2 - photoW;
  const values = rows.map((r) => formatValue(r.value, metric));

  // What the header will really occupy, not what it is allowed to occupy.
  // headerBudget stays as the hard ceiling the title/source caps enforce; this
  // is the measurement the row list is sized against so a short title gives
  // its unused lines back to the rows instead of leaving dead canvas.
  const source = sourceLine(spec, metric);
  // Clamped here rather than inside estimateLines: what the header *draws* is
  // capped, but the estimator has to keep reporting what it measured so
  // titleFitProblem can see an overflow the box would have hidden.
  const titleLines = Math.min(
    estimateLines(spec.title, t.type.title, fullWidth),
    TITLE_MAX_LINES,
  );
  // Measured with the Inter table, not Anton's — this line is set in body type.
  const sourceLines = Math.min(
    estimateLines(source, t.type.source, fullWidth, INTER_CAPS),
    SOURCE_MAX_LINES,
  );
  const headerHeight = Math.min(
    t.layout.headerBudget,
    Math.round(
      titleLines * t.type.title * TITLE_LEADING +
        SOURCE_GAP +
        sourceLines * t.type.source * SOURCE_LEADING +
        HEADER_MARGIN,
    ),
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        position: "relative",
        width: t.size.w,
        height: t.size.h,
        backgroundColor: t.color.bg,
        padding: t.space.pad,
        fontFamily: t.font.display,
      }}
    >
      <BackgroundTexture />
      {showPhotos ? <PhotoPanel faces={faces} width={photoW} /> : null}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "relative",
          width: fullWidth,
          marginBottom: HEADER_MARGIN,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: t.type.title,
            color: t.color.text,
            lineHeight: TITLE_LEADING,
            maxHeight: Math.round(t.type.title * TITLE_LEADING * TITLE_MAX_LINES),
            overflow: "hidden",
          }}
        >
          {/* Hard cap, not a hope — layout.headerBudget is sized to match the
              maxHeight above exactly. Real judgment output has actually hit 3
              wrapped lines at max title length + this font size (confirmed
              against live data), so "should usually fit in 2" isn't safe
              enough; without a real cap, an unusually long title/source line
              pushes the row list down and clips the footer off the canvas. */}
          {spec.title.toUpperCase()}
        </div>
        {/* Always drawn. It states where the numbers came from, which is true
            of every list — unlike the old spec.caveat, which the model wrote
            only sometimes and which now lives in the post copy instead. */}
        <div
          style={{
            display: "flex",
            fontFamily: t.font.body,
            fontWeight: 700,
            fontSize: t.type.source,
            letterSpacing: INTER_CAPS.tracking,
            // White, not the footer's dim grey. tokens.ts's design intent is
            // that the methodology sits on the face of the card rather than
            // hiding in it — this is that line, so it reads at full contrast.
            color: t.color.text,
            marginTop: SOURCE_GAP,
            lineHeight: SOURCE_LEADING,
            maxHeight: Math.round(t.type.source * SOURCE_LEADING * SOURCE_MAX_LINES),
            overflow: "hidden",
          }}
        >
          {source.toUpperCase()}
        </div>
      </div>

      {twoColumn ? (
        <div style={{ display: "flex", flexDirection: "row", position: "relative" }}>
          {(() => {
            const mid = Math.ceil(rows.length / 2);
            const left = rows.slice(0, mid);
            const right = rows.slice(mid);
            // Both columns share one metrics object sized off `mid`, the
            // larger column's count (matches computeRowMetrics's own
            // "visualRows" contract above). An odd total leaves the right
            // column one row short — it keeps the left column's row size and
            // stops early with a gap beneath, rather than stretching its
            // rows taller to fake an equal row count.
            const metrics = computeRowMetrics(mid, true, values, headerHeight, (fullWidth - t.layout.columnGap) / 2);
            // Explicit width per column, not flexGrow — flexGrow alone (even
            // with flexBasis: 0) produced overlapping, unusable columns here;
            // computing the split by hand is what the single-column title
            // width fix above already relies on, so this matches that pattern
            // rather than fighting Satori's flex distribution again.
            const colWidth = (fullWidth - t.layout.columnGap) / 2;
            return (
              <>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    width: colWidth,
                    marginRight: t.layout.columnGap,
                  }}
                >
                  {left.map((r, i) => (
                    <Row
                      key={r.entityId}
                      row={r}
                      rank={i + 1}
                      metric={metric}
                      metrics={metrics}
                      logoDataUri={visuals.get(rowKey(r))?.dataUri ?? null}
                      accentColor={visuals.get(rowKey(r))?.accent ?? null}
                      shortName={visuals.get(rowKey(r))?.shortName ?? null}
                    />
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", width: colWidth }}>
                  {right.map((r, i) => (
                    <Row
                      key={r.entityId}
                      row={r}
                      rank={left.length + i + 1}
                      metric={metric}
                      metrics={metrics}
                      logoDataUri={visuals.get(rowKey(r))?.dataUri ?? null}
                      accentColor={visuals.get(rowKey(r))?.accent ?? null}
                      shortName={visuals.get(rowKey(r))?.shortName ?? null}
                    />
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            position: "relative",
            width: fullWidth,
          }}
        >
          {(() => {
            const metrics = computeRowMetrics(rows.length, false, values, headerHeight, fullWidth);
            return rows.map((r, i) => (
              <Row
                key={r.entityId}
                row={r}
                rank={i + 1}
                metric={metric}
                metrics={metrics}
                logoDataUri={visuals.get(rowKey(r))?.dataUri ?? null}
                accentColor={visuals.get(rowKey(r))?.accent ?? null}
                shortName={visuals.get(rowKey(r))?.shortName ?? null}
              />
            ));
          })()}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          position: "relative",
          // Constrained like every other block on the list side. The photo
          // panel is absolutely positioned and therefore does not push flex
          // siblings aside — without an explicit width the methodology line
          // ran full-bleed and its tail disappeared underneath the photos.
          width: fullWidth,
          marginTop: 32,
        }}
      >
        <img
          src={brandLogo}
          width={t.brand.w}
          height={t.brand.h}
          style={{ width: t.brand.w, height: t.brand.h, objectFit: "contain", marginRight: 16 }}
        />
        <div
          style={{
            display: "flex",
            fontSize: t.type.footer,
            fontFamily: t.font.mono,
            color: t.color.dim,
          }}
        >
          {footerLine(list)}
        </div>
      </div>
    </div>
  );
}

async function loadFonts() {
  // Drop the .ttf files into fonts/ — see fonts/README.md.
  const anton = await readFile("fonts/Anton-Regular.ttf");
  return [
    // Anton ships one weight. Registering it at both 400 and 700 means a
    // `fontWeight: 700` anywhere in the tree resolves to Anton rather than
    // silently falling through to the next registered family.
    { name: t.font.display, data: anton, weight: 400 as const, style: "normal" as const },
    { name: t.font.display, data: anton, weight: 700 as const, style: "normal" as const },
    {
      name: t.font.body,
      data: await readFile("fonts/Inter-Regular.ttf"),
      weight: 400 as const,
      style: "normal" as const,
    },
    {
      name: t.font.body,
      data: await readFile("fonts/Inter-Bold.ttf"),
      weight: 700 as const,
      style: "normal" as const,
    },
    {
      name: t.font.mono,
      data: await readFile("fonts/JetBrainsMono-Regular.ttf"),
      weight: 400 as const,
      style: "normal" as const,
    },
  ];
}

export async function renderCard(list: RankedList): Promise<{ svg: string; png: Buffer }> {
  // ESPN art direction is best-effort and never blocks: loadEspnLeague returns
  // null on any failure and every consumer treats that as "use what fetch gave
  // us." See espnAssets.ts.
  const espnBySlug = await loadEspnLeagues(list.spec.orgSlugs);

  // Only an org-row list needs conference crests, and it needs one per org
  // rather than one per row.
  const orgMarks = new Map<string, string | null>(
    list.spec.rowKind === "org"
      ? await Promise.all(
          list.spec.orgSlugs.map(
            async (slug): Promise<[string, string | null]> => [slug, await loadOrgMarkUrl(slug)],
          ),
        )
      : [],
  );

  const [visuals, fonts, brandLogo] = await Promise.all([
    resolveVisuals(list.rows, espnBySlug, orgMarks),
    loadFonts(),
    loadBrandLogo(),
  ]);
  const faces = await resolveFaces(list.rows, espnBySlug, visuals);

  const svg = await satori(
    <Card list={list} visuals={visuals} faces={faces} brandLogo={brandLogo} />,
    {
      width: t.size.w,
      height: t.size.h,
      fonts,
    },
  );

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: t.size.w },
  })
    .render()
    .asPng();

  return { svg, png };
}
