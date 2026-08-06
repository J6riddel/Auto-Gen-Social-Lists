/**
 * Card tokens. Swap these for the real Socialpruf brand values — they are
 * placeholders chosen to look like a stat sheet rather than a promo graphic.
 *
 * Design intent: the card should read as a record, not an ad. Tabular numerals,
 * hard alignment, no gradients. The footer carrying source + date + coverage is
 * the signature element — most ranking graphics hide their methodology, and
 * putting it on the face of the card is the whole brand argument.
 */

export const tokens = {
  // 4:5 — Instagram's feed-recommended portrait ratio, and taller than 1:1
  // gives the row list enough room to fit up to 25 items without clipping.
  size: { w: 1080, h: 1350 },

  color: {
    bg: "#242426", // dark neutral grey, not navy
    surface: "#2E2E31",
    rule: "#3A3A3D",
    text: "#EDEFF2",
    dim: "#8A93A0",
    accent: "#E0B341", // fallback only now — most rows carry their own
    // extracted color instead (see card.tsx's Row), this is just what's used
    // when a row has no logo/color to pull from.
  },

  // Body/display face and a tabular face for values. Numbers must be tabular
  // or the right-aligned column will jitter between rows.
  font: {
    display: "Inter",
    mono: "JetBrains Mono",
  },

  // Baseline row sizing — the reference point row scaling multiplies against,
  // not a fixed value. card.tsx stretches or compresses actual row height to
  // fill the canvas exactly regardless of row count (see computeRowMetrics),
  // so these numbers only matter at the row count they were tuned for: ~12
  // rows in one column, or ~13 per column when split into two.
  space: { pad: 72, rowGap: 6, rowH: 74, logoSize: 48, rankW: 64, padX: 20 },

  // socialpruf wordmark, in the footer next to the methodology line — small
  // and quiet, not a header banner. Sized off the source asset's own aspect
  // ratio (fonts/pruf-logo.png is ~360x78, trimmed from fonts/5.png) —
  // objectFit "contain" keeps it undistorted even though these numbers
  // aren't an exact ratio match. White+blue two-tone, so it only reads
  // correctly on a dark bg — see color.bg above.
  brand: { w: 108, h: 24 },

  type: {
    title: 60,
    subtitle: 26,
    rank: 26,
    name: 34,
    value: 34,
    footer: 20,
  },

  // Above this many rows, the list splits into two narrower columns instead
  // of clipping or shrinking to fit — every requested row (topN maxes at 24,
  // always even so both columns land on the same count) has to actually
  // appear on the card. Sized against this file's own dimensions: ~926px of
  // row-list height at 1080x1350 fits ~11-12 rows at `space`'s sizing, so the
  // threshold sits just under that.
  layout: {
    twoColumnThreshold: 12,
    columnGap: 40,
    // Fixed cost of everything that isn't the row list: title + caveat +
    // margins, and the footer line + its margin. Not a guess — card.tsx hard-
    // caps the title at 3 lines and the caveat at 2 (maxHeight + overflow:
    // hidden), and this is sized to match those caps exactly: title 60*1.1*3
    // + gap 14 + caveat 26*1.3*2 + marginBottom 44 = ~324, rounded up for
    // safety. A real max-length title did wrap to 3 lines at this font size
    // — confirmed against live data — so "usually fits in 2" wasn't safe;
    // without a real cap here, a long title pushes the row list down and
    // clips the footer off the canvas.
    headerBudget: 330,
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
  spaceTwoCol: { rowGap: 6, rowH: 54, rankW: 40, logoSize: 32, padX: 12 },
  typeTwoCol: { rank: 18, name: 21, value: 21 },
} as const;
