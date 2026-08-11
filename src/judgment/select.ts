/**
 * Judgment. One API call: awareness packet in, ListSpec out.
 *
 * Deliberately not an agent loop. This call has no tools, no file access, and
 * no follow-up turn, which is what makes it reproducible from the receipt and
 * what keeps it costing a fraction of a cent.
 */

import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { ListSpecSchema, type AwarenessPacket, type ListSpec } from "../types.js";

const MODEL = process.env.SP_MODEL ?? "claude-sonnet-5";

const client = new Anthropic({
  apiKey: process.env.SP_ANTHROPIC_KEY,
});

function systemPrompt(taste: string): string {
  return `You choose which ranked list Socialpruf posts today.

You will be given an awareness packet describing exactly what data exists right
now. You may only propose a list that the packet supports. If the packet says an
org tracks 22 of 32 teams, you cannot propose a list of all 32.

The packet's recentPosts lists the last several lists actually posted, each with
its org, metric, and platform mix. Cross-reference it before proposing — a repeat
of the same metric/platform combo (even for a different org) is exactly the kind
of staleness the editorial standard below asks you to avoid.

Editorial standard you are being judged against:

${taste}

Respond with a single JSON object and nothing else — no prose, no markdown
fences. Write "reasoning" first and let it drive the fields that follow —
don't decide the list first and rationalize it after. Shape:

{
  "reasoning": string,         // under 500 chars. What the packet supports, why
                               // this org/angle over the alternatives, any
                               // coverage or platform-count tradeoff you weighed.
  "title": string,            // reads as a headline, under 70 chars
  "orgSlugs": string[],       // 1-8, each must appear in the packet. See the
                               // three list shapes below.
  "rowKind": "entity" | "org", // what one row is
  "subgroup": string | null,  // narrows a single org to one of its
                               // packet.orgs[].subgroups (a division or
                               // conference), or null for the whole org
  "platforms": string[],      // each must appear in EVERY listed org's platforms.
                               // Length 1, or 3-4 — never 2 (see taste rules).
                               // Every entity is ranked on the sum across this
                               // exact set, so it must mean the same thing for
                               // every entity in the list.
  "metric": string,           // one of packet.metrics[].id — not fixed to
                               // followers/emv, use whichever metric in the
                               // packet makes the most interesting list
  "excludeOwnAccount": boolean, // see below
  "dateRange": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } | null,
  "topN": number,             // even, 4-24 (odd counts split into uneven card
                               // columns). 24 is the default whenever the orgs
                               // you picked track 24+ entities between them;
                               // see the editorial standard on list length.
  "sortDir": "desc" | "asc",
  "angle": string,            // why this is worth posting, under 280 chars
  "caveat": string | null     // framing the numbers need to be read honestly,
                               // under 120 chars. It goes into the post copy,
                               // not onto the card — the card states its own
                               // platforms and window deterministically.
}

There are three shapes a list can take. Pick the one the finding actually is,
not the widest one available:

1. One org's entities — orgSlugs: ["nhl-league"], rowKind "entity". The default.
2. A subgroup of one org — same, plus subgroup: "AFC East". Only names listed in
   that org's packet.orgs[].subgroups are valid. Note a division is often only
   4-5 teams, which is a thin list; prefer it when the division itself is the
   story.
3. Several orgs at once, one of two ways:
   - rowKind "entity" pools their individual entities into one ranking. Only
     legal when every listed org shares the same "family" — an individual team
     from one league is not a peer of one from another. The four college
     conferences share a family, so a list spanning all of them is one fair
     comparison.
   - rowKind "org" makes each org a row, valued at the sum of its entities.
     Families may differ here, because every row is the same kind of total.
     topN must equal the number of orgs, and the metric must have
     aggregable: true — a rate cannot be summed into an org total.

Each entry in packet.metrics has a pointInTime flag: true means the metric is
a current-value snapshot and dateRange must be null (e.g. followers); false
means it's summed/computed over a window and dateRange must be set (e.g. emv,
engagement rate, follower growth). Never end a date range later than the org's
freshestDataDate. A metric's unit and caveat are also in packet.metrics —
read them; a percent-unit metric is not a count, and a metric whose caveat
warns it's noisy or can be negative (e.g. new followers, which nets gains
against losses) needs framing on the card, not avoidance by default.

Some orgs track an umbrella account alongside their individual entities — the
packet's ownAccountName field on that org, if not null (e.g. a league's own
account sitting next to its teams). It isn't a peer of the entities you're
ranking, so it usually doesn't belong in a "which team/creator is biggest"
list — set excludeOwnAccount to true for those. But this is a judgment call,
not a fixed rule: if the list is explicitly about comparing the umbrella
account too (or the org has no ownAccountName), decide accordingly. Always
set this field; it's a no-op if the org has no ownAccountName.`;
}

export async function selectList(
  packet: AwarenessPacket,
  rejectionNote?: string,
): Promise<{ spec: ListSpec; usage: unknown }> {
  const taste = await readFile("config/taste.md", "utf8");

  const userContent = rejectionNote
    ? `${JSON.stringify(packet)}\n\nYour previous proposal was rejected: ${rejectionNote}\nPropose a different list that avoids this problem.`
    : JSON.stringify(packet);

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    // claude-sonnet-5 does extended thinking by default, and that budget is
    // carved out of max_tokens — a long thinking pass can eat the whole
    // budget and leave no room for the JSON. The "reasoning" field above is
    // the deliberation step instead: it's visible, bounded, lands in the
    // receipt, and costs ordinary output tokens instead of an opaque
    // thinking budget. This SDK predates the `thinking` param, so it's
    // passed through untyped.
    thinking: { type: "disabled" },
    system: systemPrompt(taste),
    messages: [{ role: "user", content: userContent }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .replace(/```json|```/g, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Judgment did not return JSON. Got: ${text.slice(0, 200)}`);
  }

  return { spec: ListSpecSchema.parse(parsed), usage: res.usage };
}
