import { jsonError, jsonOk, HttpError } from "../../_lib/http";
import { readEnv } from "../../_lib/env";
import { persistLog } from "../../_lib/log";
import { markDueSchedules } from "../mark-due";

export async function POST(request: Request) {
  try {
    const secret = readEnv("CRON_SECRET");
    if (!secret) throw new HttpError(404, "Not found.", "not_found");
    const header = request.headers.get("x-saypay-cron") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (header !== secret) throw new HttpError(401, "Unauthorized.", "unauthorized");
    const result = await markDueSchedules();
    await persistLog("info", "schedules_marked_due", { marked: result.marked });
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
