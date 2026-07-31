import { getDb } from "../../../../db";
import { authChallenges, profiles } from "../../../../db/schema";
import { isValidNimiqAddress } from "../../../_lib/units";
import { normaliseAddress } from "../../_lib/auth";
import { eq } from "drizzle-orm";

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,23}$/;

export async function POST(request: Request) {
  const payload = await request.json() as { walletAddress?: string; handle?: string };
  const walletAddress = payload.walletAddress?.trim() ?? "";
  const handle = payload.handle?.trim().toLowerCase() ?? "";
  if (!isValidNimiqAddress(walletAddress) || !HANDLE_PATTERN.test(handle)) {
    return Response.json({ error: "A valid Nimiq address and a 3–24 character handle are required." }, { status: 400 });
  }

  const normalisedWallet = normaliseAddress(walletAddress);
  const nonce = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  // Keep the signed payload one-line ASCII. Some mobile WebViews route provider
  // requests through URL parsers that reject multi-line text before the wallet
  // ever receives it. Sign the same string the client displays.
  const message = `SayPay profile claim | @${handle} | ${walletAddress} | ${nonce}`;
  try {
    const db = getDb();
    const [taken] = await db.select({ walletAddress: profiles.walletAddress }).from(profiles).where(eq(profiles.handle, handle)).limit(1);
    if (taken && taken.walletAddress !== normalisedWallet) {
      return Response.json({ error: `@${handle} is already taken. Choose a different SayPay ID.` }, { status: 409 });
    }
    await db.insert(authChallenges).values({ nonce, walletAddress, handle, expiresAt });
    return Response.json({ nonce, message, expiresAt });
  } catch (error) {
    return Response.json({ error: "Could not start the wallet link.", detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
