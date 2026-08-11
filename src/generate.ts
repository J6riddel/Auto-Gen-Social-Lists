/**
 * The run. awareness -> judgment -> feasibility -> fetch -> verify -> render.
 *
 * Ends with files on disk and nothing posted. Posting is `pnpm post` and stays
 * a separate command permanently — that separation is the difference between
 * an automated content strategy and a bot that published a wrong ranking at 3am.
 */

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { appendHistory, historyEntry } from "./awareness/history.js";
import { buildPacket } from "./awareness/packet.js";
import { selectList } from "./judgment/select.js";
import { checkFeasible } from "./feasibility/gate.js";
import { buildList } from "./fetch/build.js";
import { verify } from "./verify/checks.js";
import { renderCard } from "./render/card.js";
import { writeCaption } from "./judgment/caption.js";
import { redact } from "./fetch/keyring.js";
import type { ListSpec } from "./types.js";

const MAX_JUDGMENT_ATTEMPTS = 2;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

async function main() {
  console.log("→ awareness");
  const packet = await buildPacket();
  if (packet.orgs.length === 0) throw new Error("No orgs reachable. Nothing to do.");
  console.log(`  ${packet.orgs.length} org(s) available`);

  console.log("→ judgment");
  let spec: ListSpec | undefined;
  let rejection: string | undefined;
  const usages: unknown[] = [];

  for (let attempt = 1; attempt <= MAX_JUDGMENT_ATTEMPTS; attempt++) {
    let result: Awaited<ReturnType<typeof selectList>>;
    try {
      result = await selectList(packet, rejection);
    } catch (err) {
      // A malformed or schema-invalid response is the same class of problem
      // as an infeasible one: judgment proposed something unusable. Give it
      // the same named-reason retry instead of crashing the run.
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`  attempt ${attempt} invalid: ${reason}`);
      rejection = reason;
      continue;
    }
    usages.push(result.usage);
    const gate = checkFeasible(result.spec, packet);
    if (gate.ok) {
      spec = result.spec;
      break;
    }
    console.log(`  attempt ${attempt} rejected: ${gate.reason}`);
    rejection = gate.reason;
  }

  if (!spec) {
    console.log("✗ no feasible list after retries. Nothing posted.");
    process.exit(0);
  }
  console.log(`  "${spec.title}"`);

  console.log("→ fetch");
  const list = await buildList(spec);
  console.log(`  ${list.rows.length} rows`);

  console.log("→ verify");
  const check = verify(list);
  for (const w of check.warnings) console.log(`  ⚠ ${w}`);
  if (!check.ok) {
    for (const f of check.failures) console.log(`  ✗ ${f}`);
    console.log("✗ verification failed. Nothing rendered.");
    process.exit(1);
  }

  console.log("→ caption");
  const caption = await writeCaption(list);

  console.log("→ render");
  const { svg, png } = await renderCard(list);

  // One timestamp for the directory, the receipt and the history line, so the
  // committed digest and the receipt it summarises can be matched up.
  const generatedAt = new Date().toISOString();

  const dir = `output/${generatedAt.slice(0, 10)}_${slugify(spec.title)}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/card.png`, png);
  await writeFile(`${dir}/card.svg`, svg);
  await writeFile(`${dir}/caption.txt`, caption);
  await writeFile(
    `${dir}/receipt.json`,
    JSON.stringify(
      redact({
        generatedAt,
        spec,
        rawQuery: list.rawQuery,
        queriedAt: list.queriedAt,
        rows: list.rows,
        warnings: check.warnings,
        model: process.env.SP_MODEL ?? "claude-sonnet-5",
        usage: usages,
      }),
      null,
      2,
    ),
  );

  // Novelty state. Written here rather than in `pnpm post` because judgment
  // should not re-propose a list it already picked, whether or not that card
  // survived review.
  await appendHistory(historyEntry(spec, generatedAt));

  console.log(`\n✓ ${dir}`);
  console.log(`  review the card, then: pnpm post ${dir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
