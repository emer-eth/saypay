import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { activity, scheduledPayments } from "../../../db/schema";
import { isValidNimiqAddress } from "../../_lib/units";
import { requireUser } from "../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../_lib/http";
import { persistLog } from "../_lib/log";
import { handleOf, requireLunas } from "../_lib/money";
import { profileByHandle } from "../_lib/people";
import { recordConfirmedPayment } from "../_lib/record-payment";

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const rows = await db.select().from(scheduledPayments).where(eq(scheduledPayments.creatorWallet, session.walletAddress)).orderBy(asc(scheduledPayments.runAt));
    return jsonOk({ schedules: rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{
      recipientHandle?: string;
      recipientWallet?: string;
      amount?: number;
      note?: string;
      runAt?: string | number;
      recurrence?: "once" | "weekly";
    }>(request);

    const amountLunas = requireLunas(payload.amount);
    const note = payload.note?.trim().slice(0, 120) || "Scheduled payment";
    const recurrence = payload.recurrence === "weekly" ? "weekly" : "once";
    const runAtMs = typeof payload.runAt === "number" ? payload.runAt : Date.parse(String(payload.runAt ?? ""));
    if (!Number.isFinite(runAtMs) || runAtMs < Date.now() - 60_000) {
      throw new HttpError(400, "Pick a future date and time for this payment.", "invalid_time");
    }

    let recipientWallet = (payload.recipientWallet ?? "").replace(/\s/g, "").toUpperCase();
    let recipientHandle = handleOf(payload.recipientHandle ?? "") || null;
    if (recipientHandle) {
      const person = await profileByHandle(recipientHandle);
      recipientWallet = person.walletAddress;
    }
    if (!isValidNimiqAddress(recipientWallet)) {
      throw new HttpError(400, "Choose a SayPay @handle or a valid Nimiq address.", "invalid_recipient");
    }
    if (recipientWallet === session.walletAddress) {
      throw new HttpError(400, "You cannot schedule a payment to yourself.", "self_pay");
    }

    const db = getDb();
    const id = crypto.randomUUID();
    await db.insert(scheduledPayments).values({
      id,
      creatorWallet: session.walletAddress,
      recipientWallet,
      recipientHandle,
      amountLunas,
      note,
      runAt: runAtMs,
      recurrence,
      status: "scheduled",
    });
    await db.insert(activity).values({
      id: crypto.randomUUID(),
      walletAddress: session.walletAddress,
      kind: "schedule",
      title: `Scheduled ${amountLunas / 100_000} NIM${recipientHandle ? ` to @${recipientHandle}` : ""}`,
      amountLunas,
      status: "scheduled",
      referenceId: id,
    });
    await persistLog("info", "schedule_created", { wallet: session.walletAddress, id });
    return jsonOk({
      schedule: { id, amountLunas, note, runAt: runAtMs, recurrence, status: "scheduled", recipientHandle, recipientWallet },
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{
      id?: string;
      action?: "cancel" | "complete";
      transactionHint?: string;
      transactionReference?: string;
    }>(request);
    if (!payload.id || !payload.action) throw new HttpError(400, "A schedule id and action are required.", "missing_fields");
    const db = getDb();
    const [row] = await db.select().from(scheduledPayments).where(and(
      eq(scheduledPayments.id, payload.id),
      eq(scheduledPayments.creatorWallet, session.walletAddress),
    )).limit(1);
    if (!row) throw new HttpError(404, "Schedule not found.", "not_found");

    if (payload.action === "cancel") {
      if (!["scheduled", "due"].includes(row.status)) throw new HttpError(409, "This schedule cannot be cancelled.", "conflict");
      await db.update(scheduledPayments).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(eq(scheduledPayments.id, row.id));
      return jsonOk({ ok: true, status: "cancelled" });
    }

    if (payload.action === "complete") {
      if (!["scheduled", "due"].includes(row.status)) throw new HttpError(409, "This schedule is not open for payment.", "conflict");
      const recorded = await recordConfirmedPayment({
        senderWallet: session.walletAddress,
        recipientWallet: row.recipientWallet,
        amountLunas: row.amountLunas,
        note: row.note,
        kind: "schedule-payment",
        hint: payload.transactionHint ?? payload.transactionReference,
        referenceId: row.id,
        activityTitle: `Paid scheduled: ${row.note}`,
      });
      await db.update(scheduledPayments).set({
        status: "completed",
        paidTransactionHash: recorded.txHash,
        updatedAt: new Date().toISOString(),
      }).where(eq(scheduledPayments.id, row.id));
      if (row.recurrence === "weekly") {
        await db.insert(scheduledPayments).values({
          id: crypto.randomUUID(),
          creatorWallet: row.creatorWallet,
          recipientWallet: row.recipientWallet,
          recipientHandle: row.recipientHandle,
          amountLunas: row.amountLunas,
          currency: row.currency,
          note: row.note,
          runAt: row.runAt + 7 * 24 * 60 * 60 * 1000,
          recurrence: "weekly",
          status: "scheduled",
        });
      }
      await persistLog("info", "schedule_paid", { wallet: session.walletAddress, id: row.id, txHash: recorded.txHash });
      return jsonOk({ ok: true, status: "completed", txHash: recorded.txHash, confirmations: recorded.confirmations });
    }

    throw new HttpError(400, "Unknown schedule action.", "unknown_action");
  } catch (error) {
    return jsonError(error);
  }
}
