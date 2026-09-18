import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { authChallenges, profiles } from "../../../../db/schema";
import { isValidNimiqAddress } from "../../../_lib/units";
import { normaliseAddress } from "../../_lib/auth";
import { clientIp, jsonError, jsonOk, readJson, HttpError } from "../../_lib/http";
import { persistLog } from "../../_lib/log";
import { handleOf } from "../../_lib/money";
import { rateLimit } from "../../_lib/rate-limit";

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,23}$/;

export async function POST(request: Request) {
  try {
    await rateLimit(`challenge:${clientIp(request)}`, 10);
    const payload = await readJson<{ walletAddress?: string; handle?: string }>(request);
    const walletAddress = payload.walletAddress?.trim() ?? "";
    const handle = handleOf(payload.handle ?? "");
    if (!isValidNimiqAddress(walletAddress) || !HANDLE_PATTERN.test(handle)) {
      throw new HttpError(400, "A valid Nimiq address and a 3–24 character handle are required.", "invalid_claim");
    }

    const normalisedWallet = normaliseAddress(walletAddress);
    const nonce = crypto.randomUUID();
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const message = `SayPay profile claim | @${handle} | ${walletAddress} | ${nonce}`;
    const db = getDb();
    const [taken] = await db.select({ walletAddress: profiles.walletAddress }).from(profiles).where(eq(profiles.handle, handle)).limit(1);
    if (taken && taken.walletAddress !== normalisedWallet) {
      throw new HttpError(409, `@${handle} is already taken. Choose a different SayPay ID.`, "handle_taken");
    }
    await db.insert(authChallenges).values({ nonce, walletAddress, handle, expiresAt });
    await persistLog("info", "auth_challenge", { wallet: normalisedWallet, handle });
    return jsonOk({ nonce, message, expiresAt });
  } catch (error) {
    return jsonError(error);
  }
}
