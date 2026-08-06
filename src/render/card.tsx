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
import type { RankedList, RankedRow } from "../types.js";

// Display-only: the card shows the mascot, not the city (Chicago Blackhawks
// -> Blackhawks). Dropping the first word breaks on multi-word cities (Tampa
// Bay, New York, Los Angeles, St. Louis) and multi-word mascots (Blue
// Jackets, Golden Knights, Maple Leafs, Red Wings) alike, so this is a real
// lookup table rather than a heuristic. row.name itself is untouched — the
// footer's n= line, the receipt, and the caption all still need the full
// official name; only the row label shortens. An unmatched name (a
// non-NHL org, or a name typo'd differently than expected) just falls back
// to the full name unchanged, same "degrade, don't break" pattern as a dead
// logo URL.
const NHL_SHORT_NAMES: Record<string, string> = {
  "anaheim ducks": "Ducks",
  "arizona coyotes": "Coyotes",
  "boston bruins": "Bruins",
  "buffalo sabres": "Sabres",
  "calgary flames": "Flames",
  "carolina hurricanes": "Hurricanes",
  "chicago blackhawks": "Blackhawks",
  "colorado avalanche": "Avalanche",
  "columbus blue jackets": "Blue Jackets",
  "dallas stars": "Stars",
  "detroit red wings": "Red Wings",
  "edmonton oilers": "Oilers",
  "florida panthers": "Panthers",
  "los angeles kings": "Kings",
  "minnesota wild": "Wild",
  "montreal canadiens": "Canadiens",
  "nashville predators": "Predators",
  "new jersey devils": "Devils",
  "new york islanders": "Islanders",
  "new york rangers": "Rangers",
  "ottawa senators": "Senators",
  "philadelphia flyers": "Flyers",
  "pittsburgh penguins": "Penguins",
  "san jose sharks": "Sharks",
  "seattle kraken": "Kraken",
  "st. louis blues": "Blues",
  "st louis blues": "Blues",
  "tampa bay lightning": "Lightning",
  "toronto maple leafs": "Maple Leafs",
  "utah hockey club": "Hockey Club",
  "utah mammoth": "Mammoth",
  "vancouver canucks": "Canucks",
  "vegas golden knights": "Golden Knights",
  "washington capitals": "Capitals",
  "winnipeg jets": "Jets",
};

const NFL_SHORT_NAMES: Record<string, string> = {
  "arizona cardinals": "Cardinals",
  "atlanta falcons": "Falcons",
  "baltimore ravens": "Ravens",
  "buffalo bills": "Bills",
  "carolina panthers": "Panthers",
  "chicago bears": "Bears",
  "cincinnati bengals": "Bengals",
  "cleveland browns": "Browns",
  "dallas cowboys": "Cowboys",
  "denver broncos": "Broncos",
  "detroit lions": "Lions",
  "green bay packers": "Packers",
  "houston texans": "Texans",
  "indianapolis colts": "Colts",
  "jacksonville jaguars": "Jaguars",
  "kansas city chiefs": "Chiefs",
  "las vegas raiders": "Raiders",
  "los angeles chargers": "Chargers",
  "los angeles rams": "Rams",
  "miami dolphins": "Dolphins",
  "minnesota vikings": "Vikings",
  "new england patriots": "Patriots",
  "new orleans saints": "Saints",
  "new york giants": "Giants",
  "new york jets": "Jets",
  "philadelphia eagles": "Eagles",
  "pittsburgh steelers": "Steelers",
  "san francisco 49ers": "49ers",
  "seattle seahawks": "Seahawks",
  "tampa bay buccaneers": "Buccaneers",
  "tennessee titans": "Titans",
  "washington commanders": "Commanders",
};

const NBA_SHORT_NAMES: Record<string, string> = {
  "atlanta hawks": "Hawks",
  "boston celtics": "Celtics",
  "brooklyn nets": "Nets",
  "charlotte hornets": "Hornets",
  "chicago bulls": "Bulls",
  "cleveland cavaliers": "Cavaliers",
  "dallas mavericks": "Mavericks",
  "denver nuggets": "Nuggets",
  "detroit pistons": "Pistons",
  "golden state warriors": "Warriors",
  "houston rockets": "Rockets",
  "indiana pacers": "Pacers",
  "los angeles clippers": "Clippers",
  "los angeles lakers": "Lakers",
  "memphis grizzlies": "Grizzlies",
  "miami heat": "Heat",
  "milwaukee bucks": "Bucks",
  "minnesota timberwolves": "Timberwolves",
  "new orleans pelicans": "Pelicans",
  "new york knicks": "Knicks",
  "oklahoma city thunder": "Thunder",
  "orlando magic": "Magic",
  "philadelphia 76ers": "76ers",
  "phoenix suns": "Suns",
  "portland trail blazers": "Trail Blazers",
  "sacramento kings": "Kings",
  "san antonio spurs": "Spurs",
  "toronto raptors": "Raptors",
  "utah jazz": "Jazz",
  "washington wizards": "Wizards",
};

const MLB_SHORT_NAMES: Record<string, string> = {
  "arizona diamondbacks": "Diamondbacks",
  "atlanta braves": "Braves",
  "baltimore orioles": "Orioles",
  "boston red sox": "Red Sox",
  "chicago cubs": "Cubs",
  "chicago white sox": "White Sox",
  "cincinnati reds": "Reds",
  "cleveland guardians": "Guardians",
  "colorado rockies": "Rockies",
  "detroit tigers": "Tigers",
  "houston astros": "Astros",
  "kansas city royals": "Royals",
  "los angeles angels": "Angels",
  "los angeles dodgers": "Dodgers",
  "miami marlins": "Marlins",
  "milwaukee brewers": "Brewers",
  "minnesota twins": "Twins",
  "new york mets": "Mets",
  "new york yankees": "Yankees",
  "oakland athletics": "Athletics",
  athletics: "Athletics", // mid-relocation, no city in the official name
  "philadelphia phillies": "Phillies",
  "pittsburgh pirates": "Pirates",
  "san diego padres": "Padres",
  "san francisco giants": "Giants",
  "seattle mariners": "Mariners",
  "st. louis cardinals": "Cardinals",
  "st louis cardinals": "Cardinals",
  "tampa bay rays": "Rays",
  "texas rangers": "Rangers",
  "toronto blue jays": "Blue Jays",
  "washington nationals": "Nationals",
};

// Merged across leagues rather than kept as four lookups picked by org — full
// team names don't collide across leagues (every "New York ___"/"Los Angeles
// ___"/"Washington ___" etc. has a different mascot), so one flat table keeps
// displayName ignorant of which league it's rendering, same as it already is
// ignorant of which org.
const TEAM_SHORT_NAMES: Record<string, string> = {
  ...NHL_SHORT_NAMES,
  ...NFL_SHORT_NAMES,
  ...NBA_SHORT_NAMES,
  ...MLB_SHORT_NAMES,
};

function displayName(name: string): string {
  return TEAM_SHORT_NAMES[name.trim().toLowerCase()] ?? name;
}

function formatValue(value: number, metric: string): string {
  if (metric === "emv") {
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }
  return Math.round(value).toLocaleString("en-US");
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

/** WCAG relative luminance, used to pick legible text over an arbitrary
 *  accent fill — toLegibleHex only floors lightness/saturation in HSL terms,
 *  which doesn't track perceived brightness across hues (a floored yellow
 *  reads much brighter than a floored blue at the same HSL lightness). */
function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function textColorFor(bgHex: string): string {
  return relativeLuminance(bgHex) > 0.4 ? "#14141A" : "#F5F6F8";
}

/** Picks the most saturated pixel in a downscaled logo as "the" brand color
 *  — a cheap stand-in for real palette extraction that works well for sports
 *  logos (usually one or two vivid colors on a plain/transparent field).
 *  Near-white/near-black/gray/transparent pixels are skipped since they're
 *  almost always background, not the mark itself. Returns null (not a
 *  guess) when nothing qualifies, e.g. a monochrome logo — Row falls back
 *  to the default palette in that case, same as a missing logo. */
async function extractAccentColor(buf: Buffer): Promise<string | null> {
  try {
    const img = await Jimp.read(buf);
    img.resize(32, 32);
    const { data } = img.bitmap;

    let best: { r: number; g: number; b: number; sat: number } | null = null;
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

      if (!best || sat > best.sat) best = { r, g, b, sat };
    }

    return best ? toLegibleHex(best.r, best.g, best.b) : null;
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
  metric: string;
  metrics: RowMetrics;
  logoDataUri: string | null;
  accentColor: string | null;
}) {
  const isLeader = rank === 1;
  // The row itself fills with the entity's extracted color now, not just its
  // numbers — the old "gold text for #1" scheme only applies when a row has
  // no extracted color to work with. Text on top of an accent fill needs its
  // own contrast pick (textColorFor), not the fixed light/dim palette.
  const rowBg = accentColor ?? (isLeader ? t.color.surface : "transparent");
  const onAccent = accentColor ? textColorFor(accentColor) : null;
  const rankColor = onAccent ?? (isLeader ? t.color.accent : t.color.dim);
  const nameColor = onAccent ?? t.color.text;
  const valueColor = onAccent ?? (isLeader ? t.color.accent : t.color.text);
  // Scaled off the row's own height, not a fixed pixel value, so the corner
  // reads the same proportionally whether rows are stretched tall (a short
  // list) or compact (two-column mode).
  const radius = Math.max(6, Math.round(metrics.rowH * 0.16));

  return (
    <div
      key={row.entityId}
      style={{
        display: "flex",
        alignItems: "center",
        height: metrics.rowH,
        marginBottom: metrics.rowGap,
        paddingLeft: metrics.padX,
        paddingRight: metrics.padX,
        backgroundColor: rowBg,
        borderRadius: radius,
        // The fill itself now separates rows (via the marginBottom gap
        // above) — a straight rule line across a rounded rectangle would cut
        // across the curved corners, so it's dropped in favor of the gap.
      }}
    >
      <div
        style={{
          display: "flex",
          width: metrics.rankW,
          fontSize: metrics.rank,
          fontFamily: t.font.mono,
          color: rankColor,
        }}
      >
        {String(rank).padStart(2, "0")}
      </div>
      <div
        style={{
          display: "flex",
          width: metrics.logoSize,
          height: metrics.logoSize,
          borderRadius: metrics.logoSize / 2,
          marginRight: metrics.logoGap,
          backgroundColor: t.color.rule,
          overflow: "hidden",
        }}
      >
        {logoDataUri ? (
          <img
            src={logoDataUri}
            width={metrics.logoSize}
            height={metrics.logoSize}
            style={{ width: metrics.logoSize, height: metrics.logoSize, objectFit: "cover" }}
          />
        ) : null}
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
          fontWeight: isLeader ? 700 : 400,
        }}
      >
        {displayName(row.name)}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: metrics.value,
          fontFamily: t.font.mono,
          color: valueColor,
        }}
      >
        {formatValue(row.value, metric)}
      </div>
    </div>
  );
}

function footerLine(list: RankedList): string {
  const { spec, rows } = list;
  const range = spec.dateRange
    ? `${spec.dateRange.start} to ${spec.dateRange.end}`
    : `as of ${list.queriedAt.slice(0, 10)}`;
  // No "socialpruf" text prefix — the wordmark image sitting right next to
  // this line already carries that.
  return `${spec.platforms.join("+")} · ${range} · n=${rows.length}`;
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

      {rows.length > t.layout.twoColumnThreshold ? (
        <div style={{ display: "flex", flexDirection: "row" }}>
          {(() => {
            const mid = Math.ceil(rows.length / 2);
            const left = rows.slice(0, mid);
            const right = rows.slice(mid);
            // Each column scales off its own row count, not a shared `mid`.
            // An odd total leaves the right column one row short — sizing it
            // separately means its rows stretch taller to still reach the
            // same bottom edge as the left column, instead of matching the
            // left column's row size and stopping early with a gap beneath.
            const leftMetrics = computeRowMetrics(left.length, true);
            const rightMetrics = computeRowMetrics(right.length, true);
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
                      metric={spec.metric}
                      metrics={leftMetrics}
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
                      metric={spec.metric}
                      metrics={rightMetrics}
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
                metric={spec.metric}
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
