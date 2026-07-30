import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { profiles } from "../../../db/schema";
import { normaliseAddress } from "../_lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle")?.trim().toLowerCase();
  const wallet = url.searchParams.get("wallet")?.trim();
  if (!handle && !wallet) return Response.json({ error: "Provide a SayPay ID or wallet address." }, { status: 400 });
  const db = getDb();
  const [profile] = handle
    ? await db.select({ handle: profiles.handle, walletAddress: profiles.walletAddress }).from(profiles).where(eq(profiles.handle, handle)).limit(1)
    : await db.select({ handle: profiles.handle, walletAddress: profiles.walletAddress }).from(profiles).where(eq(profiles.walletAddress, normaliseAddress(wallet ?? ""))).limit(1);
  if (!profile) return Response.json({ error: "SayPay user not found." }, { status: 404 });
  return Response.json({ profile });
}
