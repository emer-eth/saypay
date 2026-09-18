import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { contacts, profiles } from "../../../db/schema";
import { isValidNimiqAddress } from "../../_lib/units";
import { normaliseAddress, requireUser } from "../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../_lib/http";
import { persistLog } from "../_lib/log";
import { handleOf } from "../_lib/money";
import { profileByHandle } from "../_lib/people";

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const rows = await db
      .select({
        walletAddress: contacts.contactWallet,
        nickname: contacts.nickname,
        verifiedAt: contacts.verifiedAt,
        handle: profiles.handle,
      })
      .from(contacts)
      .leftJoin(profiles, eq(contacts.contactWallet, profiles.walletAddress))
      .where(eq(contacts.ownerWallet, session.walletAddress));
    return jsonOk({ contacts: rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{ contactWallet?: string; handle?: string; nickname?: string; verified?: boolean }>(request);
    const nickname = payload.nickname?.trim().slice(0, 48) ?? "";
    if (!nickname) throw new HttpError(400, "Give this person a short name.", "missing_name");
    if (payload.verified !== true) {
      throw new HttpError(400, "Confirm you compared the full address before saving.", "unverified");
    }

    const db = getDb();
    let contactWallet = payload.contactWallet?.trim() ?? "";
    const handle = handleOf(payload.handle ?? "");
    if (handle) {
      const profile = await profileByHandle(handle);
      contactWallet = profile.walletAddress;
    }
    contactWallet = normaliseAddress(contactWallet);
    if (!isValidNimiqAddress(contactWallet)) {
      throw new HttpError(400, "Use a verified SayPay ID or a Nimiq address.", "invalid_address");
    }
    if (contactWallet === session.walletAddress) {
      throw new HttpError(400, "You cannot add yourself as a contact.", "self_contact");
    }

    const verifiedAt = new Date().toISOString();
    await db.insert(contacts).values({
      ownerWallet: session.walletAddress,
      contactWallet,
      nickname,
      verifiedAt,
    }).onConflictDoUpdate({
      target: [contacts.ownerWallet, contacts.contactWallet],
      set: { nickname, verifiedAt },
    });
    await persistLog("info", "contact_saved", { wallet: session.walletAddress, contactWallet });
    return jsonOk({ contact: { walletAddress: contactWallet, nickname, handle: handle || null, verifiedAt } }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{ contactWallet?: string }>(request);
    const contactWallet = normaliseAddress(payload.contactWallet ?? "");
    if (!contactWallet) throw new HttpError(400, "Choose a contact to remove.", "missing_contact");
    const db = getDb();
    await db.delete(contacts).where(and(eq(contacts.ownerWallet, session.walletAddress), eq(contacts.contactWallet, contactWallet)));
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
