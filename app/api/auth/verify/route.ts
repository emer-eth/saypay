import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { authChallenges, authSessions, profiles } from "../../../../db/schema";
import { addressFromPublicKey, normaliseAddress, verifySignedMessage } from "../../_lib/nimiq-verify";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { nonce?: string; walletAddress?: string; signature?: string; publicKey?: string; language?: string };
    const nonce = payload.nonce ?? "";
    const walletAddress = payload.walletAddress?.trim() ?? "";
    const db = getDb();
    const [challenge] = await db.select().from(authChallenges).where(and(eq(authChallenges.nonce, nonce), isNull(authChallenges.consumedAt))).limit(1);
    if (!challenge || challenge.expiresAt < Date.now() || normaliseAddress(challenge.walletAddress) !== normaliseAddress(walletAddress)) {
      return Response.json({ error: "This profile claim has expired. Please try again." }, { status: 401 });
    }

    const message = `SayPay profile claim | @${challenge.handle} | ${challenge.walletAddress} | ${challenge.nonce}`;
    if (!payload.signature || !payload.publicKey || !(await verifySignedMessage(message, payload.signature, payload.publicKey))) {
      return Response.json({ error: "The wallet signature could not be verified." }, { status: 401 });
    }

    // Binds the signature to the address being claimed. Without this any valid
    // key pair could claim any address.
    if (normaliseAddress(addressFromPublicKey(payload.publicKey)) !== normaliseAddress(walletAddress)) {
      return Response.json({ error: "The signature does not match the selected wallet." }, { status: 401 });
    }

    const normalisedWallet = normaliseAddress(walletAddress);
    const [profile] = await db.insert(profiles).values({ walletAddress: normalisedWallet, handle: challenge.handle, publicKey: payload.publicKey, language: payload.language ?? "en" }).onConflictDoUpdate({ target: profiles.walletAddress, set: { handle: challenge.handle, publicKey: payload.publicKey, language: payload.language ?? "en", updatedAt: new Date().toISOString() } }).returning();
    await db.update(authChallenges).set({ consumedAt: Date.now() }).where(eq(authChallenges.nonce, challenge.nonce));
    const token = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await db.insert(authSessions).values({ token, walletAddress: normalisedWallet, expiresAt });
    return Response.json({ profile, token, expiresAt });
  } catch (error) {
    // Keep the cause. A bare catch here hid a TypeError behind a generic
    // message for long enough that the real problem looked like a wallet fault.
    return Response.json({ error: "Unable to verify the SayPay profile.", detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
