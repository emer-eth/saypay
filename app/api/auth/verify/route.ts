import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { authChallenges, authSessions, profiles } from "../../../../db/schema";
import { jsonError, jsonOk, readJson, HttpError } from "../../_lib/http";
import { persistLog } from "../../_lib/log";
import {
  addressFromPublicKey,
  normaliseAddress,
  verifySignedMessageDetailed,
} from "../../_lib/nimiq-verify";

export async function POST(request: Request) {
  try {
    const payload = await readJson<{
      nonce?: string;
      walletAddress?: string;
      signature?: string;
      publicKey?: string;
      language?: string;
      message?: string;
    }>(request);

    const nonce = payload.nonce ?? "";
    const walletAddress = payload.walletAddress?.trim() ?? "";
    const db = getDb();
    const [challenge] = await db
      .select()
      .from(authChallenges)
      .where(and(eq(authChallenges.nonce, nonce), isNull(authChallenges.consumedAt)))
      .limit(1);
    if (!challenge || challenge.expiresAt < Date.now() || normaliseAddress(challenge.walletAddress) !== normaliseAddress(walletAddress)) {
      throw new HttpError(401, "This profile claim has expired. Please try again.", "challenge_expired");
    }

    const message = `SayPay profile claim | @${challenge.handle} | ${challenge.walletAddress} | ${challenge.nonce}`;
    if (payload.message && payload.message !== message) {
      throw new HttpError(401, "The signed message does not match this claim.", "message_mismatch");
    }

    const verified = await verifySignedMessageDetailed(message, payload.signature, payload.publicKey);
    if (!verified.ok) {
      await persistLog("warn", "auth_verify_failed", {
        wallet: walletAddress,
        detail: verified.detail,
      });
      throw new HttpError(401, "The wallet signature could not be verified.", "bad_signature", verified.detail);
    }

    const keyHex = verified.publicKeyHex ?? "";
    if (normaliseAddress(addressFromPublicKey(keyHex)) !== normaliseAddress(walletAddress)) {
      throw new HttpError(401, "The signature does not match the selected wallet.", "key_mismatch");
    }

    const normalisedWallet = normaliseAddress(walletAddress);
    const [profile] = await db.insert(profiles).values({
      walletAddress: normalisedWallet,
      handle: challenge.handle,
      publicKey: keyHex,
      language: payload.language ?? "en",
    }).onConflictDoUpdate({
      target: profiles.walletAddress,
      set: {
        handle: challenge.handle,
        publicKey: keyHex,
        language: payload.language ?? "en",
        updatedAt: new Date().toISOString(),
      },
    }).returning();
    await db.update(authChallenges).set({ consumedAt: Date.now() }).where(eq(authChallenges.nonce, challenge.nonce));
    const token = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await db.insert(authSessions).values({ token, walletAddress: normalisedWallet, expiresAt });
    await persistLog("info", "auth_verified", { wallet: normalisedWallet, handle: challenge.handle, method: verified.method });
    return jsonOk({ profile, token, expiresAt, verifyMethod: verified.method });
  } catch (error) {
    return jsonError(error);
  }
}
