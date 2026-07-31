import { and, desc, eq, lte } from "drizzle-orm";
import { getDb } from "../../../db";
import { activity, scheduledPayments } from "../../../db/schema";

/** Marks scheduled payments as due and writes activity inbox rows. */
export async function markDueSchedules() {
  const db = getDb();
  const now = Date.now();
  const due = await db.select().from(scheduledPayments).where(and(
    eq(scheduledPayments.status, "scheduled"),
    lte(scheduledPayments.runAt, now),
  )).orderBy(desc(scheduledPayments.runAt)).limit(100);

  for (const row of due) {
    await db.update(scheduledPayments).set({ status: "due", updatedAt: new Date().toISOString() }).where(eq(scheduledPayments.id, row.id));
    await db.insert(activity).values({
      id: crypto.randomUUID(),
      walletAddress: row.creatorWallet,
      kind: "schedule-due",
      title: `Due: ${row.amountLunas / 100_000} NIM${row.recipientHandle ? ` to @${row.recipientHandle}` : ""} — confirm in Nimiq Pay`,
      amountLunas: row.amountLunas,
      status: "due",
      referenceId: row.id,
    });
  }
  return { marked: due.length };
}
