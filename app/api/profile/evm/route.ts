import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { profiles } from "../../../../db/schema";
import { requireUser } from "../../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../../_lib/http";
import { isEvmAddress } from "../../_lib/polygon";

// The signed-in user's Polygon address, where USDT for their invoices is sent. It comes from
// Nimiq Pay's own EVM wallet (eth_requestAccounts), the same address on every EVM chain.

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const [row] = await getDb().select({ evmAddress: profiles.evmAddress }).from(profiles).where(eq(profiles.walletAddress, session.walletAddress)).limit(1);
    return jsonOk({ evmAddress: row?.evmAddress ?? null });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{ address?: string }>(request);
    const address = (payload.address ?? "").trim();
    if (!isEvmAddress(address)) throw new HttpError(400, "That isn't a valid Polygon address.", "invalid_evm_address");
    await getDb().update(profiles).set({ evmAddress: address.toLowerCase(), updatedAt: new Date().toISOString() }).where(eq(profiles.walletAddress, session.walletAddress));
    return jsonOk({ evmAddress: address.toLowerCase() });
  } catch (error) {
    return jsonError(error);
  }
}
