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

Editorial standard you are being judged against:

${taste}

Respond with a single JSON object and nothing else — no prose, no markdown
fences. Shape:

{
  "title": string,            // reads as a headline, under 70 chars
  "orgSlug": string,          // must appear in the packet
  "platform": string,         // must appear in that org's platforms
  "metric": "followers" | "emv",
  "dateRange": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } | null,
  "topN": number,             // 3-25
  "sortDir": "desc" | "asc",
  "angle": string,            // why this is worth posting, under 280 chars
  "caveat": string | null     // shown on the card footer, under 120 chars
}

dateRange must be null when metric is "followers" (it is a point-in-time
snapshot) and must be set when metric is "emv". Never end a date range later
than the org's freshestDataDate.`;
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
    system: systemPrompt(taste),
    messages: [{ role: "user", content: userContent }],
  });

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
