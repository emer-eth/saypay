import { and, eq } from "drizzle-orm";
import { requireSession } from "../_lib/auth";
import { getDb } from "../../../db";
import { contacts, profiles } from "../../../db/schema";

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const db = getDb();
  const rows = await db.select({ walletAddress: contacts.contactWallet, nickname: contacts.nickname, handle: profiles.handle }).from(contacts).leftJoin(profiles, eq(contacts.contactWallet, profiles.walletAddress)).where(eq(contacts.ownerWallet, session.walletAddress));
  return Response.json({ contacts: rows });
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as { contactWallet?: string; nickname?: string };
  const contactWallet = payload.contactWallet?.trim() ?? "";
  const nickname = payload.nickname?.trim().slice(0, 48) ?? "";
  if (!contactWallet.startsWith("NQ") || !nickname) return Response.json({ error: "Choose a verified SayPay user and a name for them." }, { status: 400 });
  const db = getDb();
  await db.insert(contacts).values({ ownerWallet: session.walletAddress, contactWallet, nickname }).onConflictDoUpdate({ target: [contacts.ownerWallet, contacts.contactWallet], set: { nickname } });
  return Response.json({ contact: { walletAddress: contactWallet, nickname } }, { status: 201 });
}
