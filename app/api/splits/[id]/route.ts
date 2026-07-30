import { and, eq } from "drizzle-orm";
import { requireSession } from "../../_lib/auth";
import { getDb } from "../../../../db";
import { activity, profiles, splitGroups, splitParticipants } from "../../../../db/schema";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const db = getDb();
  const [split] = await db.select().from(splitGroups).where(eq(splitGroups.id, params.id)).limit(1);
  if (!split) return Response.json({ error: "This SayPay split was not found." }, { status: 404 });
  const [creator] = await db.select({ handle: profiles.handle }).from(profiles).where(eq(profiles.walletAddress, split.creatorWallet)).limit(1);
  const session = await requireSession(request);
  const [participant] = session ? await db.select({ shareLunas: splitParticipants.shareLunas, status: splitParticipants.status }).from(splitParticipants).where(and(eq(splitParticipants.splitId, params.id), eq(splitParticipants.participantWallet, session.walletAddress))).limit(1) : [];
  return Response.json({ split: { ...split, creatorHandle: creator?.handle ?? "saypay-user", participant } });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as { transactionReference?: string };
  const db = getDb();
  const [split] = await db.select().from(splitGroups).where(eq(splitGroups.id, params.id)).limit(1);
  const [participant] = await db.select().from(splitParticipants).where(and(eq(splitParticipants.splitId, params.id), eq(splitParticipants.participantWallet, session.walletAddress))).limit(1);
  if (!split || !participant) return Response.json({ error: "This split is not assigned to your SayPay ID." }, { status: 403 });
  if (participant.status !== "pending") return Response.json({ error: "Your share is already being processed." }, { status: 409 });
  await db.update(splitParticipants).set({ status: "submitted", paidTransactionHash: payload.transactionReference?.slice(0, 160) ?? null }).where(eq(splitParticipants.id, participant.id));
  await db.insert(activity).values({ id: crypto.randomUUID(), walletAddress: session.walletAddress, kind: "split-payment", title: `Paid split: ${split.note}`, amountLunas: participant.shareLunas, status: "submitted", referenceId: params.id });
  return Response.json({ ok: true, status: "submitted" });
}
