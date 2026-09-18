import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { profiles } from "../../../db/schema";
import { HttpError } from "./http";
import { handleOf } from "./money";

export async function profileByHandle(raw: string) {
  const handle = handleOf(raw);
  if (!/^[a-z0-9][a-z0-9-]{2,23}$/.test(handle)) {
    throw new HttpError(400, "SayPay IDs are 3–24 characters: letters, numbers, hyphens.", "invalid_handle");
  }
  const db = getDb();
  const [profile] = await db.select().from(profiles).where(eq(profiles.handle, handle)).limit(1);
  if (!profile) throw new HttpError(404, `@${handle} has not claimed a SayPay ID.`, "not_found");
  return profile;
}

export async function profilesByHandles(raw: string[]) {
  const unique = [...new Set(raw.map(handleOf).filter(Boolean))];
  const found = await Promise.all(unique.map((handle) => profileByHandle(handle)));
  return found;
}
