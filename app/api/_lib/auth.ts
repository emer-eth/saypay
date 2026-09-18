import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../../../db";
import { authSessions } from "../../../db/schema";
import { normaliseNimiqAddress } from "../../_lib/units";
import { HttpError } from "./http";

export const normaliseAddress = normaliseNimiqAddress;

export async function requireSession(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return null;
  const db = getDb();
  const [session] = await db.select().from(authSessions).where(and(eq(authSessions.token, token), gt(authSessions.expiresAt, Date.now()))).limit(1);
  return session ?? null;
}

export async function requireUser(request: Request) {
  const session = await requireSession(request);
  if (!session) throw new HttpError(401, "Sign in with Nimiq Pay first.", "unauthorized");
  return session;
}
