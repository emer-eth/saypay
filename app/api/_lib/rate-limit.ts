import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { rateLimits } from "../../../db/schema";
import { HttpError } from "./http";

const WINDOW_MS = 60_000;

export async function rateLimit(key: string, max: number) {
  const db = getDb();
  const now = Date.now();
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);
  if (!row || now - row.windowStart >= WINDOW_MS) {
    await db.insert(rateLimits).values({ key, windowStart: now, count: 1 }).onConflictDoUpdate({
      target: rateLimits.key,
      set: { windowStart: now, count: 1 },
    });
    return;
  }
  if (row.count >= max) {
    throw new HttpError(429, "Too many requests. Wait a minute and try again.", "rate_limited");
  }
  await db.update(rateLimits).set({ count: row.count + 1 }).where(eq(rateLimits.key, key));
}
