import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { authChallenges, authSessions, profiles } from "../../../../db/schema";

function normaliseAddress(address: string) {
  return address.replace(/\s/g, "").toUpperCase();
}

// Some current Nimiq Pay iOS builds show a signature sheet but fail while
// returning the result to the WebView. This route keeps onboarding usable with
// the account consent the wallet already granted through listAccounts(). It is
// deliberately labelled as a wallet link in the product, never as a signature
// verification. Every transfer still needs a native wallet confirmation.
export async function POST(request: Request) {
  try {
    const payload = await request.json() as { nonce?: string; walletAddress?: string; language?: string };
    const nonce = payload.nonce ?? "";
    const walletAddress = payload.walletAddress?.trim() ?? "";
    const db = getDb();
    const [challenge] = await db.select().from(authChallenges).where(and(eq(authChallenges.nonce, nonce), isNull(authChallenges.consumedAt))).limit(1);
    if (!challenge || challenge.expiresAt < Date.now() || normaliseAddress(challenge.walletAddress) !== normaliseAddress(walletAddress)) {
      return Response.json({ error: "This wallet-link request has expired. Please try again." }, { status: 401 });
    }

    const normalisedWallet = normaliseAddress(walletAddress);
    const [profile] = await db.insert(profiles).values({
      walletAddress: normalisedWallet,
      handle: challenge.handle,
      publicKey: "linked-through-nimiq-pay",
      language: payload.language ?? "en",
    }).onConflictDoUpdate({
      target: profiles.walletAddress,
      set: { handle: challenge.handle, publicKey: "linked-through-nimiq-pay", language: payload.language ?? "en", updatedAt: new Date().toISOString() },
    }).returning();
    await db.update(authChallenges).set({ consumedAt: Date.now() }).where(eq(authChallenges.nonce, challenge.nonce));
    const token = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await db.insert(authSessions).values({ token, walletAddress: normalisedWallet, expiresAt });
    return Response.json({ profile, token, expiresAt });
  } catch (error) {
    const message = error instanceof Error && /unique/i.test(error.message)
      ? "That SayPay ID is already taken. Choose a different one."
      : "Unable to link this Nimiq Pay account.";
    return Response.json({ error: message }, { status: 500 });
  }
}
