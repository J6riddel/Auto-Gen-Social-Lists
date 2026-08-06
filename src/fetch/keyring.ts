/**
 * The only module in this repo that reads API keys.
 *
 * Nothing else imports process.env for a Socialpruf key. Keys resolve from an
 * org slug at fetch time and never enter a prompt, a log line, a cached
 * response, or a receipt. If you are ever looking at a prompt dump that
 * contains a key, something upstream is importing the wrong thing.
 */

import "dotenv/config";
import orgsConfig from "../../config/orgs.json" with { type: "json" };
import type { MetricConfig, OrgConfig } from "../types.js";

const ORGS = orgsConfig.orgs as OrgConfig[];
const METRICS = orgsConfig.metrics as MetricConfig[];

export function listOrgs(): OrgConfig[] {
  return ORGS;
}

export function getOrg(slug: string): OrgConfig {
  const org = ORGS.find((o) => o.slug === slug);
  if (!org) {
    throw new Error(
      `Unknown org slug "${slug}". Known: ${ORGS.map((o) => o.slug).join(", ")}`,
    );
  }
  return org;
}

export function getMetric(id: string): MetricConfig {
  const metric = METRICS.find((m) => m.id === id);
  if (!metric) {
    throw new Error(
      `Unknown metric "${id}". Known: ${METRICS.map((m) => m.id).join(", ")}`,
    );
  }
  return metric;
}

/** Resolve slug -> key. Throws rather than falling back, so a missing key
 *  fails loudly at the top of a run instead of producing an empty list. */
export function keyFor(slug: string): string {
  const org = getOrg(slug);
  const key = process.env[org.keyEnv];
  if (!key) {
    throw new Error(
      `Missing ${org.keyEnv} for org "${slug}". Add it to .env (local) or repo secrets (Actions).`,
    );
  }
  return key;
}

/** Which orgs are usable right now. Used by the probe so a missing key
 *  degrades to "org unavailable" rather than crashing the whole run. */
export function configuredOrgs(): OrgConfig[] {
  return ORGS.filter((o) => Boolean(process.env[o.keyEnv]));
}

/** Defence in depth: scrub anything key-shaped before it reaches a log or
 *  receipt. Widen the pattern once you know your real key format. */
export function redact<T>(value: T): T {
  const secrets = ORGS.map((o) => process.env[o.keyEnv]).filter(
    (v): v is string => Boolean(v && v.length > 8),
  );
  let json = JSON.stringify(value);
  for (const s of secrets) json = json.split(s).join("[REDACTED]");
  return JSON.parse(json) as T;
}
