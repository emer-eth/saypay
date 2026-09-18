import { requireUser } from "../_lib/auth";
import { jsonError, jsonOk, HttpError } from "../_lib/http";
import { getAccountBalanceLunas } from "../_lib/nimiq-rpc";
import { lunasToNim } from "../../_lib/units";

async function usdPerNim() {
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=usd", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { "nimiq-2"?: { usd?: number } };
    const price = payload["nimiq-2"]?.usd;
    return typeof price === "number" && Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const lunas = await getAccountBalanceLunas(session.walletAddress);
    if (lunas === null) throw new HttpError(502, "Could not read the Nimiq balance from the node.", "rpc_unavailable");
    const nim = lunasToNim(lunas);
    const price = await usdPerNim();
    return jsonOk({
      lunas,
      nim,
      usd: price == null ? null : Number((nim * price).toFixed(2)),
      usdPerNim: price,
    });
  } catch (error) {
    return jsonError(error);
  }
}
