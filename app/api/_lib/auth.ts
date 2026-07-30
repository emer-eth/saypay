import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../../../db";
import { authSessions } from "../../../db/schema";

export function normaliseAddress(address: string) {
  return address.replace(/\s/g, "").toUpperCase();
}

export async function requireSession(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return null;
  const db = getDb();
  const [session] = await db.select().from(authSessions).where(and(eq(authSessions.token, token), gt(authSessions.expiresAt, Date.now()))).limit(1);
  return session ?? null;
}
