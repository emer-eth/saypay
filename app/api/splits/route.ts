import { desc, eq, inArray } from "drizzle-orm";
import { requireSession } from "../_lib/auth";
import { getDb } from "../../../db";
import { activity, profiles, splitGroups, splitParticipants } from "../../../db/schema";

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const db = getDb();
  const invited = await db.select({ participant: splitParticipants, split: splitGroups }).from(splitParticipants).innerJoin(splitGroups, eq(splitParticipants.splitId, splitGroups.id)).where(eq(splitParticipants.participantWallet, session.walletAddress)).orderBy(desc(splitGroups.createdAt));
  const created = await db.select().from(splitGroups).where(eq(splitGroups.creatorWallet, session.walletAddress)).orderBy(desc(splitGroups.createdAt));
  return Response.json({ invited, created });
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as { participantHandles?: string[]; amount?: number; note?: string };
  const handles = [...new Set((payload.participantHandles ?? []).map((handle) => handle.replace(/^@/, "").trim().toLowerCase()).filter(Boolean))];
  const amount = Number(payload.amount);
  const amountLunas = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100_000) : 0;
  const note = payload.note?.trim().slice(0, 120) ?? "";
  if (!handles.length || !amountLunas || !note) return Response.json({ error: "Add participants, an amount, and a note." }, { status: 400 });
  const db = getDb();
  const members = await db.select().from(profiles).where(inArray(profiles.handle, handles));
  if (members.length !== handles.length) return Response.json({ error: "Every participant needs a claimed SayPay ID." }, { status: 404 });
  const totalPeople = members.length + 1;
  const shareLunas = Math.floor(amountLunas / totalPeople);
  const creatorShareLunas = amountLunas - (shareLunas * members.length);
  if (shareLunas <= 0) return Response.json({ error: "The split amount is too small for this number of people." }, { status: 400 });
  const id = crypto.randomUUID();
  await db.insert(splitGroups).values({ id, creatorWallet: session.walletAddress, amountLunas, note });
  await db.insert(splitParticipants).values(members.map((member) => ({ id: crypto.randomUUID(), splitId: id, participantWallet: member.walletAddress, shareLunas })));
  await db.insert(activity).values({ id: crypto.randomUUID(), walletAddress: session.walletAddress, kind: "split", title: `Split: ${note}`, amountLunas, status: "open", referenceId: id });
  return Response.json({ split: { id, amountLunas, shareLunas, creatorShareLunas, participants: members.map((member) => member.handle) } }, { status: 201 });
}
