import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { paymentRequests, splitGroups, splitParticipants, timeEntries } from "../../../db/schema";
import { requireUser } from "../_lib/auth";
import { handlesForWallets, linesForRequests, presentRequest } from "../_lib/invoices";
import { jsonError, jsonOk } from "../_lib/http";
import { invoiceBucket } from "../_lib/work";

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const me = session.walletAddress;
    const requests = await db.select().from(paymentRequests).where(or(
      eq(paymentRequests.creatorWallet, me),
      eq(paymentRequests.recipientWallet, me),
    )).orderBy(desc(paymentRequests.createdAt));

    const lineMap = await linesForRequests(requests.map((row) => row.id));
    const handles = await handlesForWallets(requests.flatMap((row) => [row.creatorWallet, row.recipientWallet]));
    const presented = requests.map((row) => presentRequest(row, lineMap.get(row.id) ?? [], handles));

    const receivable = presented.filter((row) => row.creatorWallet === me && row.status === "open");
    const payable = presented.filter((row) => row.recipientWallet === me && row.status === "open");
    const dueToday = receivable.filter((row) => invoiceBucket(row.dueAt, row.status) === "due_today");
    const overdue = receivable.filter((row) => invoiceBucket(row.dueAt, row.status) === "overdue");

    const pendingShares = await db.select({
      id: splitParticipants.id,
      splitId: splitParticipants.splitId,
      shareLunas: splitParticipants.shareLunas,
      note: splitGroups.note,
      status: splitParticipants.status,
    }).from(splitParticipants)
      .innerJoin(splitGroups, eq(splitParticipants.splitId, splitGroups.id))
      .where(and(
        eq(splitParticipants.participantWallet, me),
        eq(splitParticipants.status, "pending"),
      ));

    const owedLunas = receivable.reduce((sum, row) => sum + row.amountLunas, 0);
    const invoiceOwe = payable.reduce((sum, row) => sum + row.amountLunas, 0);
    const splitOwe = pendingShares.reduce((sum, row) => sum + row.shareLunas, 0);

    const [running] = await db.select().from(timeEntries).where(and(
      eq(timeEntries.walletAddress, me),
      eq(timeEntries.status, "running"),
    )).limit(1);
    const unbilled = await db.select().from(timeEntries).where(and(
      eq(timeEntries.walletAddress, me),
      eq(timeEntries.status, "stopped"),
    )).orderBy(desc(timeEntries.startedAt));

    return jsonOk({
      owedLunas,
      oweLunas: invoiceOwe + splitOwe,
      dueTodayLunas: dueToday.reduce((sum, row) => sum + row.amountLunas, 0),
      overdueLunas: overdue.reduce((sum, row) => sum + row.amountLunas, 0),
      dueToday,
      overdue,
      receivable,
      payable,
      splitsOwed: pendingShares,
      timer: running ?? null,
      unbilled,
    });
  } catch (error) {
    return jsonError(error);
  }
}
