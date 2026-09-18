import { getDb } from "../../../db";
import { jsonError, jsonOk } from "../_lib/http";
import { pingRpc } from "../_lib/nimiq-rpc";

export async function GET() {
  try {
    const rpc = await pingRpc();
    let database = false;
    try {
      getDb();
      database = true;
    } catch {
      database = false;
    }
    const ok = rpc.ok && database;
    return jsonOk({ ok, rpc, database, time: new Date().toISOString() }, ok ? 200 : 503);
  } catch (error) {
    return jsonError(error);
  }
}
