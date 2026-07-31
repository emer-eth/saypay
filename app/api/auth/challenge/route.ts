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
  // Keep the signed payload one-line ASCII. Some mobile WebViews route provider
  // requests through URL parsers that reject multi-line text before the wallet
  // ever receives it. The nonce still makes every claim unique and short-lived.
  const message = `SayPay profile claim | @${handle} | ${walletAddress} | ${nonce}`;
  try {
    const db = getDb();
    await db.insert(authChallenges).values({ nonce, walletAddress, handle, expiresAt });
    return Response.json({ nonce, message, expiresAt });
  } catch (error) {
    // An unhandled throw here returns a bodyless 500, and the browser's own
    // JSON.parse failure ("The string did not match the expected pattern") is
    // what the user ends up reading. Always answer in JSON.
    return Response.json({ error: "Could not start the wallet link.", detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
