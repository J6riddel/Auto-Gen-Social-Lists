/**
 * Fast design-iteration loop for card.tsx. Renders straight from a saved
 * receipt.json — real spec + rows, no judgment/fetch/verify/caption calls —
 * so tweaking a token or a Row style doesn't cost an LLM call or a live
 * Socialpruf fetch. Run via `pnpm preview` (tsx watch): every save re-renders
 * output/_preview/card.png in place.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { renderCard } from "./card.js";
import type { RankedList } from "../types.js";

async function latestReceipt(): Promise<string> {
  const dirs = (await readdir("output", { withFileTypes: true }))
    .filter((d) => d.isDirectory() && d.name !== "_preview")
    .map((d) => d.name)
    .sort();
  const last = dirs.at(-1);
  if (!last) throw new Error("No runs in output/ yet — run `pnpm generate` at least once.");
  return `output/${last}/receipt.json`;
}

async function main() {
  // Optional arg: a specific receipt.json (or its containing dir), e.g.
  // `pnpm preview output/2026-08-06_nhl-teams-by-tiktok-followers`.
  // Defaults to the most recent run so a bare `pnpm preview` just works.
  let path = process.argv[2] ?? (await latestReceipt());
  if (!path.endsWith(".json")) path = `${path.replace(/\/$/, "")}/receipt.json`;

  const receipt = JSON.parse(await readFile(path, "utf8"));
  const list: RankedList = {
    spec: receipt.spec,
    rows: receipt.rows,
    queriedAt: receipt.queriedAt,
    rawQuery: receipt.rawQuery,
  };

  const { png } = await renderCard(list);
  await mkdir("output/_preview", { recursive: true });
  await writeFile("output/_preview/card.png", png);
  console.log(`✓ output/_preview/card.png  (from ${path})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
