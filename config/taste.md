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
- The angle depends on a caveat too long to state in the 120 characters
  `caveat` allows.

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
  of going negative (new followers), say so via `caveat`. That goes into the
  post copy, not onto the card — the card prints its own source line (which
  platforms, which window) from the spec, so don't restate those in `caveat`.
- If coverage is partial, either say "of the N we track" in the title or pick a
  different list.

## List length

- 24 rows is the house shape. When the orgs you picked track 24 or more
  rankable entities between them (packet.orgs[].entityCount, summed), default
  to topN 24 — the card renders it as two columns of twelve, and the deep part
  of the table is where the argument lives.
- Go shorter only when the shorter list is the better one, and be able to say
  why: the roster genuinely doesn't reach 24 (rank it whole instead), a
  subgroup is the story, rowKind "org" fixes the count at one row per org, or
  the tail of the ranking is noise that would undercut the claim.
- Never pad. If 24 rows means including entities with missing or stale data to
  reach the number, that is a shorter list, not a 24-row one.

## College football

- Call a program by its school, not its mascot. "Alabama", "Ohio State", "Ole
  Miss" — the card already renders it that way, and three SEC programs are
  named Tigers, so a mascot title is ambiguous on its face.
- Each conference org ranks only its own members. A cross-conference claim is
  not a list you can pick here, so don't write a title that implies one.
- A conference is small enough to rank whole (16-18 schools). Prefer the full
  conference over a top-10 slice: the bottom of the table is usually the part
  people argue about, and a slice hides it. The ACC's 17 means topN 16.
- The sport is seasonal. A window in the off-season measures brand accounts
  idling, not programs competing — either pick a window inside the season or
  say which window you used and why it's the interesting one.

## Comparing across orgs

- A pooled list (several orgs, rowKind "entity") is the strongest college post
  available: the whole Power Four ranked together settles arguments a
  single-conference list can only start. Prefer it when the cross-conference
  order is the finding.
- Conference-vs-conference (rowKind "org") is a different, also good list: four
  rows, each a whole conference. It answers "which league is actually biggest",
  which nobody can check without this data. Say plainly in the caveat that each
  row is the sum of that org's tracked entities, because a reader will assume
  it's the league's own account otherwise.
- Never sum a rate. If the interesting claim is about engagement rate, it is a
  claim about entities, not about orgs.
- An org total is only as complete as coverage. If one org tracks fewer of its
  entities than another, the totals aren't comparable and the list is not worth
  posting — say so or pick something else.

## Voice

Plain, declarative, a little dry. State the finding, then the one detail that
makes it interesting. No "🚨", no "Let that sink in", no rhetorical questions.
Assume the reader knows the sport. Never explain what EMV is in the post, link
it if you must.

Two sentences is usually right. Three is the ceiling.
