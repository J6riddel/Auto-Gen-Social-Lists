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
import { getMetric } from "../fetch/keyring.js";
import type { MetricConfig, RankedList, RankedRow } from "../types.js";
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

/** Card background is very dark (#12161C) — a color pulled straight off a
 *  logo could easily be near-black or washed-out and unreadable there, so
 *  hue is kept as-extracted but lightness/saturation are floored before
 *  rendering. This is what makes it safe to use on arbitrary team colors
 *  without checking each one by hand. */
function toLegibleHex(r: number, g: number, b: number): string {
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToHex(h, Math.max(s, 0.35), Math.max(l, 0.5));
}

/** Turns a flat brand hue into a brushed-metal fill: same hue and a capped
 *  saturation (a fully-saturated team color reads as plastic, not metal),
 *  alternating light/dark lightness stops on a diagonal to fake the banding
 *  a real reflective surface would pick up. Used for every row's fill now,
 *  not just the leader's — accentColor already falls back to t.color.accent
 *  upstream when a row has no logo to pull a hue from. */
function metallicGradient(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [h, s] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const cappedS = Math.min(s, 0.5);
  const stop = (l: number) => hslToHex(h, cappedS, l);
  return (
    `linear-gradient(135deg, ${stop(0.74)} 0%, ${stop(0.36)} 22%, ` +
    `${stop(0.6)} 45%, ${stop(0.28)} 68%, ${stop(0.7)} 88%, ${stop(0.4)} 100%)`
  );
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
}

async function resolveVisuals(rows: RankedRow[]): Promise<Map<string, RowVisual>> {
  const entries = await Promise.all(
    rows.map(async (r): Promise<[string, RowVisual]> => {
      let image = r.logoUrl ? await fetchImage(r.logoUrl) : null;
      // Primary failed (dead URL, or an unsupported format like TikTok's
      // WebP) — retry once against the same brand's Instagram avatar before
      // falling back to the placeholder. See build.ts's logoUrlFallback.
      if (!image && r.logoUrlFallback && r.logoUrlFallback !== r.logoUrl) {
        image = await fetchImage(r.logoUrlFallback);
      }
      if (!image) return [r.entityId, { dataUri: null, accent: null }];
      const dataUri = `data:${image.contentType};base64,${image.data.toString("base64")}`;
      const accent = await extractAccentColor(image.data);
      return [r.entityId, { dataUri, accent }];
    }),
  );
  return new Map(entries);
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

interface RowMetrics {
  rowH: number;
  rowGap: number;
  padX: number;
  rankW: number;
  rank: number;
  logoSize: number;
  logoGap: number;
  name: number;
  nameGap: number;
  value: number;
}

/** Rows stretch or compress to exactly fill the fixed canvas regardless of
 *  row count, so a 3-row list never leaves a dead gap before the footer and
 *  a 25-row list never clips. Height/gap scale generously — extra height
 *  just becomes breathing room around vertically-centered row content — but
 *  type and logo size scale much less, so a short list reads as "roomy,"
 *  not "giant text." `visualRows` is the tallest column's row count: the
 *  full list in single-column mode, half of it in two-column mode. */
function computeRowMetrics(visualRows: number, skinny: boolean): RowMetrics {
  const available = t.size.h - t.space.pad * 2 - t.layout.headerBudget - t.layout.footerBudget;
  const rowUnit = available / visualRows;

  const base = skinny
    ? {
        rowH: t.spaceTwoCol.rowH,
        rowGap: t.spaceTwoCol.rowGap,
        padX: t.spaceTwoCol.padX,
        rankW: t.spaceTwoCol.rankW,
        rank: t.typeTwoCol.rank,
        logoSize: t.spaceTwoCol.logoSize,
        logoGap: 10,
        name: t.typeTwoCol.name,
        nameGap: 12,
        value: t.typeTwoCol.value,
      }
    : {
        rowH: t.space.rowH,
        rowGap: t.space.rowGap,
        padX: t.space.padX,
        rankW: t.space.rankW,
        rank: t.type.rank,
        logoSize: t.space.logoSize,
        logoGap: 16,
        name: t.type.name,
        nameGap: 20,
        value: t.type.value,
      };

  const baseUnit = base.rowH + base.rowGap;
  const heightScale = clamp(rowUnit / baseUnit, t.layout.heightScaleRange);
  const fontScale = clamp(rowUnit / baseUnit, t.layout.fontScaleRange);

  return {
    rowH: Math.round(base.rowH * heightScale),
    rowGap: Math.max(2, Math.round(base.rowGap * heightScale)),
    padX: base.padX,
    rankW: Math.round(base.rankW * fontScale),
    rank: Math.max(12, Math.round(base.rank * fontScale)),
    logoSize: Math.max(16, Math.round(base.logoSize * fontScale)),
    logoGap: Math.round(base.logoGap * fontScale),
    name: Math.max(14, Math.round(base.name * fontScale)),
    nameGap: Math.round(base.nameGap * fontScale),
    value: Math.max(14, Math.round(base.value * fontScale)),
  };
}

function Row({
  row,
  rank,
  metric,
  metrics,
  logoDataUri,
  accentColor,
}: {
  row: RankedRow;
  rank: number;
  metric: MetricConfig;
  metrics: RowMetrics;
  logoDataUri: string | null;
  accentColor: string | null;
}) {
  // Every row now fills with a brushed-metal gradient built off the entity's
  // extracted brand hue (or t.color.accent when a row has no logo/color to
  // pull from — see extractAccentColor). Row text is pinned to white
  // regardless of that fill's contrast pick.
  const baseHue = accentColor ?? t.color.accent;
  const nameColor = "#FFFFFF";
  const valueColor = "#FFFFFF";
  // Scaled off the row's own height, not a fixed pixel value, so the corner
  // reads the same proportionally whether rows are stretched tall (a short
  // list) or compact (two-column mode).
  const radius = Math.max(6, Math.round(metrics.rowH * 0.16));
  const borderWidth = Math.max(1, Math.round(metrics.rowH * 0.02));

  // Logo panel is a hard square, exactly the row's height — "fills the left
  // square portion" — with its right edge cut on a diagonal instead of
  // running straight down. The row's own overflow: hidden + borderRadius
  // below is what rounds the panel's top-left/bottom-left corners to match
  // the pill, rather than duplicating the radius on the panel itself.
  const logoSize = metrics.rowH;
  const slash = Math.round(logoSize * 0.24);
  const numberSize = Math.max(14, Math.round(logoSize * 0.32));
  const numberInset = Math.max(4, Math.round(logoSize * 0.09));

  return (
    <div
      key={row.entityId}
      style={{
        display: "flex",
        alignItems: "center",
        position: "relative",
        overflow: "hidden",
        height: metrics.rowH,
        marginBottom: metrics.rowGap,
        paddingRight: metrics.padX,
        backgroundImage: metallicGradient(baseHue),
        borderRadius: radius,
        borderWidth,
        borderStyle: "solid",
        borderColor: "#FFFFFF",
        // The fill itself now separates rows (via the marginBottom gap
        // above) — a straight rule line across a rounded rectangle would cut
        // across the curved corners, so it's dropped in favor of the gap.
      }}
    >
      {/* Legibility fade for the value text sitting on a bright metallic
          fill — transparent through the left/center of the row, darkening
          toward the right edge where the number sits. zIndex keeps it
          behind the logo/name/value content instead of painting over it. */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage:
            "linear-gradient(to right, transparent 0%, transparent 50%, rgba(0,0,0,0.55) 100%)",
          zIndex: 0,
        }}
      />
      <div
        style={{
          display: "flex",
          position: "relative",
          flexShrink: 0,
          width: logoSize,
          height: logoSize,
          marginRight: metrics.logoGap,
          backgroundImage: metallicGradient(baseHue),
          overflow: "hidden",
          clipPath: `polygon(0px 0px, ${logoSize}px 0px, ${logoSize - slash}px ${logoSize}px, 0px ${logoSize}px)`,
          zIndex: 1,
        }}
      >
        {logoDataUri ? (
          <img
            src={logoDataUri}
            width={logoSize}
            height={logoSize}
            style={{ width: logoSize, height: logoSize, objectFit: "cover" }}
          />
        ) : null}
        {/* Legibility fade for the rank number — black at the bottom edge of
            the logo panel, fading up to transparent by a third of the way
            into the image, so the number stays readable over light logos. */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 45%)",
            zIndex: 1,
          }}
        />
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: numberInset,
            bottom: numberInset,
            fontSize: numberSize,
            fontFamily: t.font.display,
            fontWeight: 700,
            color: "#FFFFFF",
            textShadow: "0 2px 6px rgba(0,0,0,0.55)",
            zIndex: 2,
          }}
        >
          {String(rank).padStart(2, "0")}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexGrow: 1,
          minWidth: 0, // without this a flex item won't shrink past its content
          // width, so long names can run straight into the value column with
          // zero gap — confirmed happening on real team names before this fix.
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          marginRight: metrics.nameGap,
          fontSize: metrics.name,
          color: nameColor,
          fontWeight: 700,
          position: "relative",
          zIndex: 1,
        }}
      >
        {displayName(row.name)}
      </div>
      <div
        style={{
          display: "flex",
          flexShrink: 0, // name already yields via minWidth:0 + ellipsis above;
          // pinning this to its content width is what stops a long name from
          // squeezing the number itself off the row.
          whiteSpace: "nowrap",
          fontSize: metrics.value,
          fontFamily: t.font.mono,
          fontWeight: 700,
          color: valueColor,
          position: "relative",
          zIndex: 1,
        }}
      >
        {formatValue(row.value, metric)}
      </div>
    </div>
  );
}

function footerLine(list: RankedList): string {
  const { spec } = list;
  const range = spec.dateRange
    ? `${spec.dateRange.start} to ${spec.dateRange.end}`
    : `as of ${list.queriedAt.slice(0, 10)}`;
  // No "socialpruf" text prefix — the wordmark image sitting right next to
  // this line already carries that.
  return `${spec.platforms.join("+")} · ${range}`;
}

function Card({
  list,
  visuals,
  brandLogo,
}: {
  list: RankedList;
  visuals: Map<string, RowVisual>;
  brandLogo: string;
}) {
  const { spec, rows } = list;
  const metric = getMetric(spec.metric);
  // Explicit width, not just flexGrow — Satori sizes a flex item to its
  // content first and only grows from there, so without a hard width a long
  // title can push past the canvas edge instead of wrapping inside it.
  const fullWidth = t.size.w - t.space.pad * 2;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: t.size.w,
        height: t.size.h,
        backgroundColor: t.color.bg,
        padding: t.space.pad,
        fontFamily: t.font.display,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: fullWidth, marginBottom: 44 }}>
        <div
          style={{
            display: "flex",
            fontSize: t.type.title,
            color: t.color.text,
            fontWeight: 700,
            lineHeight: 1.1,
            // Hard cap, not a hope — layout.headerBudget is sized to match
            // this exactly. Real judgment output has actually hit 3 wrapped
            // lines at max title length + this font size (confirmed against
            // live data), so "should usually fit in 2" isn't safe enough;
            // without a real cap, an unusually long title/caveat pushes the
            // whole row list down and clips the footer off the canvas.
            maxHeight: t.type.title * 1.1 * 3,
            overflow: "hidden",
          }}
        >
          {spec.title}
        </div>
        {spec.caveat ? (
          <div
            style={{
              display: "flex",
              fontSize: t.type.subtitle,
              color: t.color.dim,
              marginTop: 14,
              lineHeight: 1.3,
              maxHeight: t.type.subtitle * 1.3 * 2,
              overflow: "hidden",
            }}
          >
            {spec.caveat}
          </div>
        ) : null}
      </div>

      {rows.length >= t.layout.twoColumnThreshold ? (
        <div style={{ display: "flex", flexDirection: "row" }}>
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
            const metrics = computeRowMetrics(mid, true);
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
                      logoDataUri={visuals.get(r.entityId)?.dataUri ?? null}
                      accentColor={visuals.get(r.entityId)?.accent ?? null}
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
                      logoDataUri={visuals.get(r.entityId)?.dataUri ?? null}
                      accentColor={visuals.get(r.entityId)?.accent ?? null}
                    />
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {(() => {
            const metrics = computeRowMetrics(rows.length, false);
            return rows.map((r, i) => (
              <Row
                key={r.entityId}
                row={r}
                rank={i + 1}
                metric={metric}
                metrics={metrics}
                logoDataUri={visuals.get(r.entityId)?.dataUri ?? null}
                accentColor={visuals.get(r.entityId)?.accent ?? null}
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
  return [
    {
      name: t.font.display,
      data: await readFile("fonts/Inter-Regular.ttf"),
      weight: 400 as const,
      style: "normal" as const,
    },
    {
      name: t.font.display,
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
  const [visuals, fonts, brandLogo] = await Promise.all([
    resolveVisuals(list.rows),
    loadFonts(),
    loadBrandLogo(),
  ]);

  const svg = await satori(<Card list={list} visuals={visuals} brandLogo={brandLogo} />, {
    width: t.size.w,
    height: t.size.h,
    fonts,
  });

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: t.size.w },
  })
    .render()
    .asPng();

  return { svg, png };
}
