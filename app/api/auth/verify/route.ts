import { and, eq, isNull } from "drizzle-orm";
import { BufferUtils, Hash, PublicKey, Signature } from "@nimiq/core/web";
import { getDb } from "../../../../db";
import { authChallenges, profiles } from "../../../../db/schema";

function normaliseAddress(address: string) {
  return address.replace(/\s/g, "").toUpperCase();
}

function verifySignedMessage(message: string, signature: string, publicKey: string) {
  const prefix = "\x16 Nimiq Signed Message:\n";
  const payload = BufferUtils.fromUtf8(prefix + message.length + message);
  const hash = Hash.computeSha256(payload);
  const key = PublicKey.fromHex(publicKey);
  const signed = Signature.fromHex(signature);
  return signed.verify(key, hash);
}

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

    const message = `SayPay profile claim\nHandle: @${challenge.handle}\nWallet: ${challenge.walletAddress}\nNonce: ${challenge.nonce}`;
    if (!payload.signature || !payload.publicKey || !verifySignedMessage(message, payload.signature, payload.publicKey)) {
      return Response.json({ error: "The wallet signature could not be verified." }, { status: 401 });
    }

    const signedAddress = PublicKey.fromHex(payload.publicKey).toAddress().toUserFriendlyAddress();
    if (normaliseAddress(signedAddress) !== normaliseAddress(walletAddress)) {
      return Response.json({ error: "The signature does not match the selected wallet." }, { status: 401 });
    }

    const [profile] = await db.insert(profiles).values({ walletAddress, handle: challenge.handle, publicKey: payload.publicKey, language: payload.language ?? "en" }).onConflictDoUpdate({ target: profiles.walletAddress, set: { handle: challenge.handle, publicKey: payload.publicKey, language: payload.language ?? "en", updatedAt: new Date().toISOString() } }).returning();
    await db.update(authChallenges).set({ consumedAt: Date.now() }).where(eq(authChallenges.nonce, challenge.nonce));
    return Response.json({ profile });
  } catch {
    return Response.json({ error: "Unable to verify the SayPay profile." }, { status: 500 });
  }
}
