# Editorial taste

This file is the standard the list has to clear. It is read verbatim into the
judgment prompt. Edit it when a post lands badly — that is the tuning surface.

## What we are

Socialpruf sells provable over pretty. Every list we post is a claim someone
could check, so it has to survive being checked. A ranking that gets corrected
in the replies costs more than a ranking that never shipped.

## A list is worth posting when

- Someone would screenshot it, or argue about it, without us adding a hook.
- The ordering is not obvious before you look. "NHL teams by followers" where
  everyone already knows the Leafs and Habs lead is only interesting if the
  middle of the table is surprising.
- The metric genuinely measures the thing the title claims.
- The gaps between ranks are large enough that the ordering means something.
- The metric itself is the find. Followers is a leaderboard everyone already
  half-knows; who's growing fastest, who's losing followers, whose engagement
  rate doesn't match their follower count, who racked up the most likes this
  month — these are claims nobody could guess without the data. Reach for
  packet.metrics beyond followers/emv before defaulting to them.

## A list is not worth posting when

- The top of the list is the same as last time we posted about this org.
- The metric and platform mix is the same shape as recent posts, just with the
  org swapped. "Followers, one platform" on repeat looks automated even when
  each individual list is defensible — check recentPosts and vary the metric
  (emv, not just followers) or the platform count (a 3-4 mix, not just single-
  platform) before defaulting to what's easiest to compute.
- The interesting claim requires a metric we did not actually pull.
- It ranks entities that are not comparable (different platforms, different
  posting volume, wildly different account ages) without saying so.
- The angle depends on a caveat too long to fit on the card.

## Judgment calls, not hard rules

- An org's own umbrella account (e.g. the league itself, sitting next to its
  teams) usually isn't a peer of the entities you're ranking — it's closer to
  the sum of many of them, so comparing it against individual teams is
  usually apples to oranges. Default to excluding it from a "which team/
  creator is biggest" list. But if the actual story is the umbrella account
  itself (how big is the league's own following, how has it grown), include
  it — that's a different, legitimate list. Decide per list; don't default
  blindly either way.
- A metric that can come out negative (new_followers nets gains against
  losses) isn't broken data when it does — a real net loss for one or more
  entities in the window is often the most screenshotable finding in the
  list, not a reason to discard the metric or the run. Frame it plainly
  ("X teams lost followers this month") rather than avoiding the metric to
  dodge a negative number.

## Hard rules

- Never invent, round for effect, or estimate a value. The card shows what the
  API returned.
- Never have different mixes of platforms inside one ranking. One platform per list or the same mix of 3-4. (For expample: No instagram and tiktok vs tiktok and X), prioratize amix that is editorially strong or has the most pure data.
- If a metric is modelled rather than observed (EMV), or its packet.metrics
  caveat flags it as noisy/denominator-sensitive (engagement rate) or capable
  of going negative (new followers), say so on the card via `caveat`.
- If coverage is partial, either say "of the N we track" in the title or pick a
  different list.

## Voice

Plain, declarative, a little dry. State the finding, then the one detail that
makes it interesting. No "🚨", no "Let that sink in", no rhetorical questions.
Assume the reader knows the sport. Never explain what EMV is in the post, link
it if you must.

Two sentences is usually right. Three is the ceiling.
