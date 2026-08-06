# Fonts

Satori needs font files as buffers — it cannot use system or webfonts.

Drop these in here:

- `Inter-Regular.ttf`, `Inter-Bold.ttf` — https://fonts.google.com/specimen/Inter
- `JetBrainsMono-Regular.ttf` — https://www.jetbrains.com/lp/mono/

The mono face is not decorative. Values are right-aligned in a column, and a
proportional face makes the digits jitter between rows. Tabular figures are the
whole reason the card reads as a record rather than a graphic.

These are committed (they're small and the build needs them), so check the
licence permits redistribution — both above are OFL/Apache and fine.

## Brand logo

`pruf-logo.png` — the socialpruf wordmark, trimmed of transparent padding
from the source export `5.png` (also kept here). White+blue two-tone, so it
only reads correctly on a dark card background. `card.tsx` reads it the same
way as the fonts above: a missing file fails the whole render rather than
degrading, because unlike row logos this mark is required on every card, not
decoration.
