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
  size: { w: 1200, h: 1200 },

  color: {
    bg: "#12161C",
    surface: "#181D25",
    rule: "#2A323D",
    text: "#EDEFF2",
    dim: "#8A93A0",
    accent: "#E0B341", // leader row only — spend boldness once
  },

  // Body/display face and a tabular face for values. Numbers must be tabular
  // or the right-aligned column will jitter between rows.
  font: {
    display: "Inter",
    mono: "JetBrains Mono",
  },

  space: { pad: 72, rowGap: 6, rowH: 74 },

  type: {
    title: 54,
    subtitle: 26,
    rank: 26,
    name: 34,
    value: 34,
    footer: 20,
  },
} as const;
