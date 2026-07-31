import { and, eq } from "drizzle-orm";
import { normaliseAddress, requireSession } from "../_lib/auth";
import { getDb } from "../../../db";
import { contacts, profiles } from "../../../db/schema";

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select({ walletAddress: contacts.contactWallet, nickname: contacts.nickname, handle: profiles.handle })
    .from(contacts)
    .leftJoin(profiles, eq(contacts.contactWallet, profiles.walletAddress))
    .where(eq(contacts.ownerWallet, session.walletAddress));
  return Response.json({ contacts: rows });
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as { contactWallet?: string; handle?: string; nickname?: string };
  const nickname = payload.nickname?.trim().slice(0, 48) ?? "";
  if (!nickname) return Response.json({ error: "Give this person a short name." }, { status: 400 });

  const db = getDb();
  let contactWallet = payload.contactWallet?.trim() ?? "";
  const handle = payload.handle?.replace(/^@/, "").trim().toLowerCase() ?? "";

  if (handle) {
    const [profile] = await db.select().from(profiles).where(eq(profiles.handle, handle)).limit(1);
    if (!profile) return Response.json({ error: `@${handle} has not claimed a SayPay ID yet.` }, { status: 404 });
    contactWallet = profile.walletAddress;
  }

  contactWallet = normaliseAddress(contactWallet);
  if (!contactWallet.startsWith("NQ") || contactWallet.length < 36) {
    return Response.json({ error: "Use a verified SayPay ID or a Nimiq address." }, { status: 400 });
  }
  if (contactWallet === session.walletAddress) {
    return Response.json({ error: "You cannot add yourself as a contact." }, { status: 400 });
  }

  await db.insert(contacts).values({ ownerWallet: session.walletAddress, contactWallet, nickname }).onConflictDoUpdate({
    target: [contacts.ownerWallet, contacts.contactWallet],
    set: { nickname },
  });
  return Response.json({ contact: { walletAddress: contactWallet, nickname, handle: handle || null } }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as { contactWallet?: string };
  const contactWallet = normaliseAddress(payload.contactWallet ?? "");
  if (!contactWallet) return Response.json({ error: "Choose a contact to remove." }, { status: 400 });
  const db = getDb();
  await db.delete(contacts).where(and(eq(contacts.ownerWallet, session.walletAddress), eq(contacts.contactWallet, contactWallet)));
  return Response.json({ ok: true });
}
