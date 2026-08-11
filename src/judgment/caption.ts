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
const MAX_ATTEMPTS = 2;

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

export async function writeCaption(list: RankedList): Promise<string> {
  const taste = await readFile("config/taste.md", "utf8");
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

Return only the post text. Write one or two sentences totaling ${MIN_CAPTION_LENGTH}-${MAX_CAPTION_LENGTH}
characters, including spaces. Aim for 140-190 characters. No headline, hashtags,
emoji, or quotation marks around the caption.

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
    feedback = `\n\nYour previous draft was rejected: ${problem} Rewrite it from scratch.`;
  }

  throw new Error(`Caption failed the ${MIN_CAPTION_LENGTH}-${MAX_CAPTION_LENGTH} character requirement after ${MAX_ATTEMPTS} attempts.`);
}
