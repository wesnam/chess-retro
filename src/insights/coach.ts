import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { insights } from "@/db/schema";
import type { CoachProvider } from "./provider";
import { hashRequest, type InsightRequest } from "./request";
import { validateCoaching, type Coaching } from "./validate";

/**
 * Explaining a set of statistics, at most once.
 *
 * Every path that cannot produce coaching returns a reason rather than
 * throwing. The dashboard's statistics are the product; the prose is an
 * enhancement, and no failure of the enhancement may take the product down
 * with it — least of all an outage at someone else's API.
 */

export type CoachingResult = {
  coaching?: Coaching;
  cached: boolean;
  /** Why there is no coaching, for the dashboard to say so plainly. */
  reason?: "unavailable" | "failed" | "rejected";
};

export async function coachingFor(
  db: Db,
  user: string,
  request: InsightRequest,
  provider: CoachProvider | undefined,
): Promise<CoachingResult> {
  // No key configured. Checked before the cache because the key identifies
  // the model that wrote the entry, so without a provider there is no entry
  // to look for. Not an error: the core feature is not gated behind a paid
  // account, so this is simply the offline shape of the page.
  if (!provider) return { cached: false, reason: "unavailable" };

  const inputHash = hashRequest(request, {
    user,
    model: provider.model,
  });

  const cached = readCache(db, inputHash);
  if (cached) return { coaching: cached, cached: true };

  let raw: unknown;
  try {
    raw = await provider.explain(request);
  } catch {
    // Deliberately not cached — a transient failure must not become the
    // permanent answer for this corpus.
    return { cached: false, reason: "failed" };
  }

  const validated = validateCoaching(raw, request);
  if (!validated.ok) return { cached: false, reason: "rejected" };

  writeCache(db, { inputHash, user, request, provider, value: validated.value });
  return { coaching: validated.value, cached: false };
}

function readCache(db: Db, inputHash: string): Coaching | undefined {
  const row = db
    .select({ body: insights.body })
    .from(insights)
    .where(eq(insights.inputHash, inputHash))
    .get();

  if (!row) return undefined;

  try {
    return JSON.parse(row.body) as Coaching;
  } catch {
    // A row we cannot read is a cache miss, not a crash.
    return undefined;
  }
}

function writeCache(
  db: Db,
  entry: {
    inputHash: string;
    user: string;
    request: InsightRequest;
    provider: CoachProvider;
    value: Coaching;
  },
): void {
  db.insert(insights)
    .values({
      inputHash: entry.inputHash,
      user: entry.user,
      timeClass: entry.request.timeClass,
      body: JSON.stringify(entry.value),
      model: entry.provider.model,
      createdAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoNothing()
    .run();
}
