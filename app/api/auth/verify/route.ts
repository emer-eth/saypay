import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { authChallenges, authSessions, profiles } from "../../../../db/schema";
import {
  addressFromPublicKey,
  normaliseAddress,
  verifySignedMessageDetailed,
} from "../../_lib/nimiq-verify";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as {
      nonce?: string;
      walletAddress?: string;
      signature?: string;
      publicKey?: string;
      language?: string;
      /** Optional: exact string the wallet was asked to sign (must match challenge). */
      message?: string;
    };
    const nonce = payload.nonce ?? "";
    const walletAddress = payload.walletAddress?.trim() ?? "";
    const db = getDb();
    const [challenge] = await db
      .select()
      .from(authChallenges)
      .where(and(eq(authChallenges.nonce, nonce), isNull(authChallenges.consumedAt)))
      .limit(1);
    if (!challenge || challenge.expiresAt < Date.now() || normaliseAddress(challenge.walletAddress) !== normaliseAddress(walletAddress)) {
      return Response.json({ error: "This profile claim has expired. Please try again." }, { status: 401 });
    }

    // Rebuild the exact challenge string the client was given to sign.
    const message = `SayPay profile claim | @${challenge.handle} | ${challenge.walletAddress} | ${challenge.nonce}`;
    // If the client also echoes the message, require it to match so we never
    // verify a different payload than the one bound to this nonce.
    if (payload.message && payload.message !== message) {
      return Response.json({ error: "The signed message does not match this claim." }, { status: 401 });
    }

    const verified = await verifySignedMessageDetailed(message, payload.signature, payload.publicKey);
    if (!verified.ok) {
      return Response.json({
        error: "The wallet signature could not be verified.",
        detail: verified.detail,
        // Safe diagnostics so phone failures are actionable without logging secrets.
        debug: {
          methodTried: verified.detail,
          publicKeyBytes: verified.publicKeyHex ? verified.publicKeyHex.length / 2 : null,
          signatureBytes: verified.signatureHex ? verified.signatureHex.length / 2 : null,
          messageLength: message.length,
        },
      }, { status: 401 });
    }

    // Binds the signature to the address being claimed. Without this any valid
    // key pair could claim any address.
    const keyHex = verified.publicKeyHex ?? "";
    if (normaliseAddress(addressFromPublicKey(keyHex)) !== normaliseAddress(walletAddress)) {
      return Response.json({
        error: "The signature does not match the selected wallet.",
        detail: "publicKey does not derive to the connected Nimiq address.",
      }, { status: 401 });
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
    return Response.json({
      profile,
      token,
      expiresAt,
      verifyMethod: verified.method,
    });
  } catch (error) {
    return Response.json({
      error: "Unable to verify the SayPay profile.",
      detail: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
