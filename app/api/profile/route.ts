import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { profiles } from "../../../db/schema";
import { normaliseAddress } from "../_lib/auth";
import { jsonError, jsonOk, HttpError } from "../_lib/http";
import { handleOf } from "../_lib/money";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const handle = url.searchParams.get("handle")?.trim();
    const wallet = url.searchParams.get("wallet")?.trim();
    if (!handle && !wallet) throw new HttpError(400, "Provide a SayPay ID or wallet address.", "missing_query");
    const db = getDb();
    const [profile] = handle
      ? await db.select({ handle: profiles.handle, walletAddress: profiles.walletAddress }).from(profiles).where(eq(profiles.handle, handleOf(handle))).limit(1)
      : await db.select({ handle: profiles.handle, walletAddress: profiles.walletAddress }).from(profiles).where(eq(profiles.walletAddress, normaliseAddress(wallet ?? ""))).limit(1);
    if (!profile) throw new HttpError(404, "SayPay user not found.", "not_found");
    return jsonOk({ profile });
  } catch (error) {
    return jsonError(error);
  }
}
