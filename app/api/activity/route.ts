import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { activity } from "../../../db/schema";
import { requireUser } from "../_lib/auth";
import { jsonError, jsonOk } from "../_lib/http";

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const items = await db.select().from(activity).where(eq(activity.walletAddress, session.walletAddress)).orderBy(desc(activity.createdAt)).limit(50);
    return jsonOk({ activity: items });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST() {
  return jsonOk({
    error: "Activity is written only after an on-chain confirmation. POST /api/payments with the wallet result.",
    code: "gone",
  }, 410);
}
