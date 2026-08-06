# Fonts

Satori needs font files as buffers — it cannot use system or webfonts.

Drop these in here:

- `Anton-Regular.ttf` — https://fonts.google.com/specimen/Anton
- `Inter-Regular.ttf`, `Inter-Bold.ttf` — https://fonts.google.com/specimen/Inter
- `JetBrainsMono-Regular.ttf` — https://www.jetbrains.com/lp/mono/

Anton is the display face: titles and row names. Its *width* is doing as much
work as its weight — a full team name has to fit a half-width row in
two-column mode without ellipsis, and no proportional-width bold face manages
that at a readable size. It ships a single weight, so `card.tsx` registers the
same buffer at 400 and 700; a `fontWeight: 700` that didn't resolve would
silently fall through to Inter mid-card. It has no lowercase worth setting, so
everything drawn in it is uppercased first.

Inter is now only the caveat line under the title. The mono face is only the
footer, and it is not decorative there: the methodology line is the one place
the card makes a claim about its own provenance, and a fixed-width face is
what separates it visually from the headline material above it.

Values on the card are Anton, not mono — each sits in its own pill, and every
pill in a column is given the same computed width (see `estimateWidth`), so
the numbers align hard down the right edge without depending on tabular
figures.

These are committed (they're small and the build needs them), so check the
licence permits redistribution — all three above are OFL/Apache and fine.

## Brand logo

`pruf-logo.png` — the socialpruf wordmark, trimmed of transparent padding
from the source export `5.png` (also kept here). White+blue two-tone, so it
only reads correctly on a dark card background. `card.tsx` reads it the same
way as the fonts above: a missing file fails the whole render rather than
degrading, because unlike row logos this mark is required on every card, not
decoration.
