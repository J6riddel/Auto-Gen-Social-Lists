/**
 * Card tokens. Swap these for the real Socialpruf brand values — they are
 * placeholders chosen to look like a stat sheet rather than a promo graphic.
 *
 * Design intent: a broadcast-style ranking graphic that is still a record.
 * Every row carries its entity's own brand color and mark, and the numbers are
 * hard-aligned in fixed-width pills rather than allowed to ragged. The stated
 * methodology is the signature element — which platforms the numbers came from
 * sits under the title, the window they cover sits in the footer. Most ranking
 * graphics hide that, and putting it on the face of the card is the whole
 * brand argument.
 */

export const tokens = {
  // 4:5 — Instagram's feed-recommended portrait ratio, and taller than 1:1
  // gives the row list enough room to fit up to 25 items without clipping.
  size: { w: 1080, h: 1350 },

  color: {
    bg: "#0B0B0D", // near-black: the photo panel bleeds to the canvas edge, so
    // the list side has to be dark enough that the seam between them reads as
    // one surface rather than two panels butted together.
    surface: "#2E2E31",
    rule: "#3A3A3D",
    text: "#FFFFFF",
    dim: "#8A93A0",
    accent: "#E0B341", // fallback only now — most rows carry their own
    // extracted color instead (see card.tsx's Row), this is just what's used
    // when a row has no logo/color to pull from.
    // Logo panel inside each row. Team marks are drawn to sit on white, and
    // most leagues have at least one team whose mark is mostly white itself
    // (so a white panel would swallow it) — a very light grey holds both.
    logoPanel: "#F2F2F0",
  },

  // Values are set in `display`, not `mono` — every value pill in a column is
  // given the same computed width (see card.tsx's estimateWidth), so the
  // numbers align hard down the right edge without needing tabular figures.
  // `mono` is now only the footer's methodology line. See fonts/README.md.
  font: {
    // Condensed heavy grotesque for titles and row names. The width is the
    // point, not just the weight: a full team name has to fit a half-width
    // row without ellipsis, and a proportional-width bold face can't.
    display: "Anton",
    // Kept for the footer's methodology line, where the quieter, wider face
    // is what separates it from the headline material above it.
    body: "Inter",
    mono: "JetBrains Mono",
  },

  // Baseline row sizing — the reference point row scaling multiplies against,
  // not a fixed value. card.tsx stretches or compresses actual row height to
  // fill the canvas exactly regardless of row count (see computeRowMetrics),
  // so these numbers only matter at the row count they were tuned for: ~10
  // rows in one column, or ~13 per column when split into two.
  // The rank chip and logo panel aren't here: their widths are derived in
  // card.tsx from the row height *and* the pill's own width, because either
  // one alone gives the wrong answer at some row count. See computeRowMetrics.
  space: { pad: 56, rowGap: 12, rowH: 78, padX: 18 },

  // socialpruf wordmark, in the footer next to the methodology line — small
  // and quiet, not a header banner. Sized off the source asset's own aspect
  // ratio (fonts/pruf-logo.png is ~360x78, trimmed from fonts/5.png) —
  // objectFit "contain" keeps it undistorted even though these numbers
  // aren't an exact ratio match. White+blue two-tone, so it only reads
  // correctly on a dark bg — see color.bg above.
  brand: { w: 108, h: 24 },

  type: {
    title: 92, // Anton is condensed, so this is far larger than the old Inter
    // setting at the same measure — the headline is meant to dominate.
    // The source line under the title ("collected across every post on
    // Instagram, TikTok, X and YouTube"). Smaller than `subtitle` because it
    // is a full sentence rather than a fragment: at 24 the widest 4-platform
    // version needs three lines in single-column mode, where the photo panel
    // takes a third of the measure. At 20 it lands in two.
    source: 20,
    rank: 26,
    name: 34,
    value: 34,
    // Sized to the worst realistic case, now just a full date range — the
    // platform mix moved up to the source line. In single-column mode the
    // photo panel leaves the footer only the list column's width to fit that
    // and the wordmark. Larger than this and the date clips.
    footer: 16,
  },

  // At or above this many rows, the list splits into two narrower columns
  // instead of clipping or shrinking to fit — every requested row (topN maxes at 24,
  // always even so both columns land on the same count) has to actually
  // appear on the card. Sized against this file's own dimensions: ~926px of
  // row-list height at 1080x1350 fits ~11-12 rows at `space`'s sizing, so the
  // threshold sits just under that.
  layout: {
    twoColumnThreshold: 12,
    columnGap: 32,
    // Fixed cost of everything that isn't the row list: title + source line +
    // margins, and the footer line + its margin. Not a guess — card.tsx hard-
    // caps the title at 3 lines and the source line at 3 (maxHeight +
    // overflow: hidden), and this is sized to match those caps exactly: title
    // 92*1.05*3 + gap 12 + source 20*1.3*3 + marginBottom 30 = ~410, rounded
    // up for safety. A real max-length title did wrap to 3 lines at this font
    // size — confirmed against live data — so "usually fits in 2" wasn't
    // safe; without a real cap here, a long title pushes the row list down
    // and clips the footer off the canvas.
    headerBudget: 412,
    footerBudget: 70,
    // Row height/gap scale generously with row count (extra height just
    // becomes breathing room around vertically-centered content), while
    // type/logo size scale much less — a 3-row list should look "roomy,"
    // not "giant text."
    heightScaleRange: [0.5, 3] as [number, number],
    fontScaleRange: [0.6, 1.25] as [number, number],
  },

  // Row sizing used only in two-column mode — narrower columns need a
  // smaller rank badge and smaller type to keep team names from crowding
  // the value column. Same "baseline, not fixed" caveat as `space` above.
  spaceTwoCol: { rowGap: 8, rowH: 56, padX: 10 },
  typeTwoCol: { rank: 18, name: 21, value: 20 },

  // The photo panel: a full-bleed column down the right edge carrying the top
  // two entities' leader headshots. Only drawn in single-column mode — a
  // two-column list has no horizontal room to give up (see card.tsx).
  photo: {
    // Fraction of canvas width. The list column gets the rest, and at 0.36 a
    // full team name plus its value pill still fits without ellipsis.
    widthRatio: 0.36,
    // Two stacked cells, so each is a portrait slot roughly matching the
    // aspect of a headshot cutout.
    cells: 2,
  },
} as const;
