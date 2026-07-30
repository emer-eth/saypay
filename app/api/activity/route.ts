import { desc, eq } from "drizzle-orm";
import { requireSession } from "../_lib/auth";
import { getDb } from "../../../db";
import { activity } from "../../../db/schema";

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const db = getDb();
  const items = await db.select().from(activity).where(eq(activity.walletAddress, session.walletAddress)).orderBy(desc(activity.createdAt)).limit(30);
  return Response.json({ activity: items });
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as { kind?: string; title?: string; amountLunas?: number; transactionReference?: string };
  const kind = payload.kind?.trim().slice(0, 32) ?? "payment";
  const title = payload.title?.trim().slice(0, 120) ?? "NIM payment";
  const amountLunas = Number(payload.amountLunas);
  if (!Number.isInteger(amountLunas) || amountLunas <= 0) return Response.json({ error: "A valid NIM amount is required." }, { status: 400 });
  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(activity).values({ id, walletAddress: session.walletAddress, kind, title, amountLunas, status: "submitted", referenceId: payload.transactionReference?.slice(0, 160) ?? null });
  return Response.json({ activity: { id, status: "submitted" } }, { status: 201 });
}
