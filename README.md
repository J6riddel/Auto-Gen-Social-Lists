# socialpruf-list-bot

Picks a ranked list from Socialpruf data each day, renders it as a card, and
stages it for Social. The list is chosen by a model against a written editorial
standard; the numbers on the card are whatever the API returned.

## Run it

```bash
pnpm install
cp .env.example .env      # fill in keys
pnpm probe                # what data actually exists right now
pnpm generate             # produces output/<date>_<slug>/
pnpm post output/2026-08-06_nhl-teams-by-followers
```

`generate` never posts. That split is deliberate and permanent.

## Output

```
output/2026-08-06_nhl-teams-by-followers/
  card.png        # the thing you post
  card.svg        # source, if you want to tweak it
  caption.txt     # post copy
  receipt.json    # spec, query params, raw values, timestamp
```

`receipt.json` is the one worth keeping. When someone replies "this is wrong,"
you open it and see the exact query, range, and returned values.

## How it decides

```
awareness → judgment → feasibility → fetch → verify → caption → render
```

**Awareness** probes each org for coverage — entity counts, platforms, freshest
data date, known gaps — and compacts it into a few hundred tokens.

**Judgment** is one API call: packet in, structured `ListSpec` out. It can only
propose lists the packet supports. The editorial standard it is judged against
lives in [`config/taste.md`](config/taste.md), which is the real tuning surface
— edit that when a post lands badly.

**Feasibility** rejects impossible specs before any money is spent, with a
reason, and judgment gets one retry.

**Fetch, verify, render** make no decisions. Verify fails closed: a run that
produces nothing beats a run that produces a wrong ranking.

## Tradeoffs

The card is programmatically rendered, not AI-generated. Diffusion models mangle
text and numbers, so the visual is a deterministic template — which is also what
lets the card's numbers provably match the API response.

The model picks the list but cannot check whether it is *true* in any deeper
sense than the data supports. Near-ties, partial coverage, and non-comparable
entities are caught by explicit checks in `src/verify/checks.ts`, not by
judgment. Anything those checks don't cover will ship.

## Secrets

One key per org, resolved from a slug at fetch time in `src/fetch/keyring.ts` —
the only module that touches them. The reasoner never sees a key.

GitHub secret scanning won't recognise a Socialpruf key format (custom patterns
are a paid org feature), so the gitleaks pre-commit hook is the real first line
of defence here, not GitHub's server-side scan.

If a key ever lands in a commit, rotate it. Scrubbing history doesn't help —
it's in the object store and public repo events get scraped within minutes.

