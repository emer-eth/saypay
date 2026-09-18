import { getDb } from "../../../db";
import { eventLog } from "../../../db/schema";

export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  const line = { level, event, t: new Date().toISOString(), ...fields };
  if (level === "error") console.error(JSON.stringify(line));
  else console.log(JSON.stringify(line));
}

export async function persistLog(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  log(level, event, fields);
  try {
    const db = getDb();
    await db.insert(eventLog).values({
      id: crypto.randomUUID(),
      at: Date.now(),
      level,
      event,
      walletAddress: typeof fields.wallet === "string" ? fields.wallet : null,
      payload: JSON.stringify(fields).slice(0, 4_000),
    });
  } catch (error) {
    log("warn", "event_log_write_failed", { message: error instanceof Error ? error.message : String(error) });
  }
}
