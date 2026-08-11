/**
 * Posts a previously generated and reviewed artifact to X.
 *
 * Usage: pnpm post ./output/2026-08-06_nhl-teams-by-followers
 */

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { TwitterApi } from "twitter-api-v2";

const X_ENV_VARS = [
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_SECRET",
] as const;

function xCredentials() {
  for (const name of X_ENV_VARS) {
    if (!process.env[name]) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }

  return {
    appKey: process.env.X_API_KEY!,
    appSecret: process.env.X_API_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessSecret: process.env.X_ACCESS_SECRET!,
  };
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: pnpm post <output-dir>");
    process.exit(1);
  }

  const originalCaption = (await readFile(`${dir}/caption.txt`, "utf8")).trim();
  const caption = originalCaption;
  const png = await readFile(`${dir}/card.png`);
  const receipt = JSON.parse(await readFile(`${dir}/receipt.json`, "utf8"));

  if (!caption) throw new Error("Caption is empty.");
  if (caption.length > 280) {
    throw new Error(`Caption is ${caption.length} characters; X allows at most 280. Edit caption.txt before posting.`);
  }

  console.log(`about to post: ${receipt.spec.title}`);
  console.log(`caption (${caption.length} chars):\n${caption}\n`);
  console.log(`image: ${png.length} bytes`);

  if (process.env.DRY_RUN !== "false") {
    console.log("\nDRY_RUN - nothing sent. Set DRY_RUN=false to post for real.");
    return;
  }

  const client = new TwitterApi(xCredentials());
  const mediaId = await client.v1.uploadMedia(png, { mimeType: "image/png" });
  const result = await client.v2.tweet({
    text: caption,
    media: { media_ids: [mediaId] },
  });

  console.log(`posted: https://x.com/i/web/status/${result.data.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
