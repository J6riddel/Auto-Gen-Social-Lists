/**
 * Caption. A separate call from judgment on purpose — you will want to
 * regenerate copy that didn't land far more often than you want to re-pick the
 * list, and re-running judgment would give you a different list entirely.
 *
 * Cheap enough to run on Haiku.
 */

import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { getMetric } from "../fetch/keyring.js";
import type { RankedList } from "../types.js";

const MODEL = process.env.SP_CAPTION_MODEL ?? "claude-haiku-4-5-20251001";
const MIN_CAPTION_LENGTH = 80;
const MAX_CAPTION_LENGTH = 220;

// Length is a probabilistic constraint, so one retry is not enough coverage —
// two attempts is how the 2026-08-18 run died. Haiku drafts cost far less than
// losing a list that has already been judged, fetched and verified.
const MAX_ATTEMPTS = 4;

// The character cap restated in the unit the model can actually hold. Measured
// at 6.26 chars/word across every caption shipped so far, so 220 characters is
// about 35 words; 34 leaves slack for a long team name.
const MAX_CAPTION_WORDS = 34;

const client = new Anthropic({ apiKey: process.env.SP_ANTHROPIC_KEY });

function captionText(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** The system prompt asks for no em dash, but asking is not a guarantee and an
 *  em dash in the copy is never acceptable, so it gets removed rather than
 *  rejected: a rejection can still lose (both attempts can come back with one,
 *  and then a paid run dies at the last step), while a substitution cannot.
 *  Runs before captionProblem so the length is measured on what actually ships. */
function stripEmDashes(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    // The dash was doing a job some other punctuation already does in these
    // spots; leaving the comma in would read as a typo.
    .replace(/,\s*([,.;:!?])/g, "$1")
    .replace(/,\s*$/, "")
    .trim();
}

/** taste.md is the judgment prompt's tuning surface, and most of it is list-
 *  selection rules the caption writer cannot act on. Feeding it whole buried the
 *  length budget under ~2000 words of instruction meant for a different call. */
function voiceSection(taste: string): string {
  // The appended sentinel gives the last section in the file a terminator.
  const match = /^## Voice\s*$([\s\S]*?)(?=^## )/m.exec(`${taste}\n## `);
  return match?.[1]?.trim() ?? taste;
}

function captionProblem(text: string): string | null {
  if (text.length < MIN_CAPTION_LENGTH) {
    return `It is ${text.length} characters; use at least ${MIN_CAPTION_LENGTH}.`;
  }
  if (text.length > MAX_CAPTION_LENGTH) {
    return `It is ${text.length} characters; use at most ${MAX_CAPTION_LENGTH}.`;
  }
  if (/^['"]|['"]$/.test(text)) return "Do not wrap the caption in quotation marks.";
  if (/[#\u{1F000}-\u{1FAFF}]/u.test(text)) return "Do not use hashtags or emoji.";
  return null;
}

/** A near-miss on length is a trim, not a new idea. Handing the draft back with
 *  the number of characters to cut converges, where "rewrite it from scratch"
 *  just takes another independent draw from the same too-long distribution. */
function reviseInstruction(draft: string, problem: string): string {
  if (draft.length > MAX_CAPTION_LENGTH) {
    const excess = draft.length - MAX_CAPTION_LENGTH;
    return `\n\nYour previous draft ran ${draft.length} characters, ${excess} too many:\n\n${draft}\n\nReturn that same observation cut to ${MAX_CAPTION_LENGTH} characters or fewer. Keep the finding in the first sentence, and pay for the cut by dropping qualifiers or by shortening the second sentence to a clause, deleting it if that is still not enough. Do not reach for a different comparison.`;
  }
  if (draft.length < MIN_CAPTION_LENGTH) {
    return `\n\nYour previous draft ran only ${draft.length} characters:\n\n${draft}\n\nReturn that same observation with one more specific number from the rows, totalling ${MIN_CAPTION_LENGTH}-${MAX_CAPTION_LENGTH} characters.`;
  }
  return `\n\nYour previous draft was rejected: ${problem} Rewrite it from scratch.`;
}

export async function writeCaption(list: RankedList): Promise<string> {
  const taste = voiceSection(await readFile("config/taste.md", "utf8"));
  const metric = getMetric(list.spec.metric);

  const system = `You write the post copy that goes with a Socialpruf ranking card on X.

The card already shows the full ranked list, so do not repeat the rankings. Say
what is interesting about them.

Voice and rules:

${taste}

Write like a knowledgeable fan sharing one sharp observation, not a brand or an
analyst writing a report. Use plain words and contractions where natural. Lead
with the most surprising comparison that the supplied numbers directly prove.

Do not speculate about causes, audiences, algorithms, content quality, momentum,
or what the result "suggests." Avoid canned turns of phrase such as "the real
story," "let that sink in," "not just," "actually landing," "moving the needle,"
"towers over," and "a gap too wide to ignore." Do not tell readers how to feel.

Return only the post text. No headline, hashtags, emoji, or quotation marks
around the caption.

Length is a hard limit, and running long is by far the most common way these
drafts get rejected: at most ${MAX_CAPTION_LENGTH} characters including spaces, and at least
${MIN_CAPTION_LENGTH}. Characters are hard to feel, so budget in words instead. ${MAX_CAPTION_WORDS} words is the
ceiling; 24 to 30 is the target.

That budget buys one sentence, not two. Write the finding as a single
declarative sentence with the number in it. Add a second sentence only if it
fits in a handful of words, and cut qualifiers from the first to pay for it. A
draft that states the finding and then spends a full second sentence commenting
on it will not fit.

Never use an em dash. Where you would reach for one, use a comma, a colon, or a
second sentence instead.`;

  const facts = JSON.stringify({
    title: list.spec.title,
    angle: list.spec.angle,
    metric: { id: metric.id, label: metric.label, unit: metric.unit, caveat: metric.caveat },
    caveat: list.spec.caveat,
    rows: list.rows,
  });

  let feedback = "";
  let lastProblem = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 180,
      system,
      messages: [{ role: "user", content: `${facts}${feedback}` }],
    });

    const caption = stripEmDashes(captionText(res));
    const problem = captionProblem(caption);
    if (!problem) return caption;
    lastProblem = problem;
    feedback = reviseInstruction(caption, problem);
  }

  // Name the problem that actually stopped the run. The old message always
  // blamed length, which sends you looking in the wrong place when the cause
  // was a stray quotation mark.
  throw new Error(`Caption rejected after ${MAX_ATTEMPTS} attempts. Last problem: ${lastProblem}`);
}
