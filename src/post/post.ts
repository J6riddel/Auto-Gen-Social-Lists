/**
 * Posting. Takes a directory that `pnpm generate` already produced, so the
 * thing that goes out is the exact artifact you looked at.
 *
 * Usage: pnpm post ./output/2026-08-06_nhl-teams-by-followers
 *
 * ⚠️ TODO: wire the X client. Left unimplemented on purpose — do not connect
 * this until you have run generate enough times to trust the cards.
 */

import "dotenv/config";
import { readFile } from "node:fs/promises";

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: pnpm post <output-dir>");
    process.exit(1);
  }

  const caption = await readFile(`${dir}/caption.txt`, "utf8");
  const png = await readFile(`${dir}/card.png`);
  const receipt = JSON.parse(await readFile(`${dir}/receipt.json`, "utf8"));

  console.log(`about to post: ${receipt.spec.title}`);
  console.log(`caption (${caption.length} chars):\n${caption}\n`);
  console.log(`image: ${png.length} bytes`);

  if (process.env.DRY_RUN !== "false") {
    console.log("\nDRY_RUN — nothing sent. Set DRY_RUN=false to post for real.");
    return;
  }

  throw new Error("X client not implemented yet — see src/post/post.ts");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
