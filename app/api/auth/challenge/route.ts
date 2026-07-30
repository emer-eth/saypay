import { getDb } from "../../../../db";
import { authChallenges } from "../../../../db/schema";

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,23}$/;

export async function POST(request: Request) {
  const payload = await request.json() as { walletAddress?: string; handle?: string };
  const walletAddress = payload.walletAddress?.trim() ?? "";
  const handle = payload.handle?.trim().toLowerCase() ?? "";
  if (!walletAddress.startsWith("NQ") || !HANDLE_PATTERN.test(handle)) {
    return Response.json({ error: "A Nimiq address and a 3-24 character handle are required." }, { status: 400 });
  }

  const nonce = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const message = `SayPay profile claim\nHandle: @${handle}\nWallet: ${walletAddress}\nNonce: ${nonce}`;
  const db = getDb();
  await db.insert(authChallenges).values({ nonce, walletAddress, handle, expiresAt });
  return Response.json({ nonce, message, expiresAt });
}
