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

const client = new Anthropic({ apiKey: process.env.SP_ANTHROPIC_KEY });

export async function writeCaption(list: RankedList): Promise<string> {
  const taste = await readFile("config/taste.md", "utf8");
  const metric = getMetric(list.spec.metric);

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: `You write the post copy that goes with a Socialpruf ranking card on X.

The card already shows the full ranked list, so do not repeat the rankings. Say
what is interesting about them.

Voice and rules:

${taste}

Return only the post text. No hashtags, no emoji, no quotation marks around it.`,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          title: list.spec.title,
          angle: list.spec.angle,
          metric: { id: metric.id, label: metric.label, unit: metric.unit, caveat: metric.caveat },
          caveat: list.spec.caveat,
          rows: list.rows,
        }),
      },
    ],
  });

  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
