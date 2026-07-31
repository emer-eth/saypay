import { and, asc, eq } from "drizzle-orm";
import { requireSession } from "../_lib/auth";
import { getDb } from "../../../db";
import { activity, profiles, scheduledPayments } from "../../../db/schema";

function toLunas(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100_000) : 0;
}

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(scheduledPayments)
    .where(eq(scheduledPayments.creatorWallet, session.walletAddress))
    .orderBy(asc(scheduledPayments.runAt));
  return Response.json({ schedules: rows });
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as {
    recipientHandle?: string;
    recipientWallet?: string;
    amount?: number;
    note?: string;
    runAt?: string | number;
    recurrence?: "once" | "weekly";
  };

  const amountLunas = toLunas(payload.amount);
  const note = payload.note?.trim().slice(0, 120) || "Scheduled payment";
  const recurrence = payload.recurrence === "weekly" ? "weekly" : "once";
  const runAtMs = typeof payload.runAt === "number"
    ? payload.runAt
    : Date.parse(String(payload.runAt ?? ""));
  if (!amountLunas) return Response.json({ error: "Enter a NIM amount." }, { status: 400 });
  if (!Number.isFinite(runAtMs) || runAtMs < Date.now() - 60_000) {
    return Response.json({ error: "Pick a future date and time for this payment." }, { status: 400 });
  }

  const db = getDb();
  let recipientWallet = payload.recipientWallet?.replace(/\s/g, "").toUpperCase() ?? "";
  const recipientHandle = payload.recipientHandle?.replace(/^@/, "").trim().toLowerCase() ?? "";

  if (recipientHandle) {
    const [person] = await db.select().from(profiles).where(eq(profiles.handle, recipientHandle)).limit(1);
    if (!person) return Response.json({ error: `@${recipientHandle} has not claimed a SayPay ID.` }, { status: 404 });
    recipientWallet = person.walletAddress;
  }
  if (!recipientWallet.startsWith("NQ") || recipientWallet.length < 36) {
    return Response.json({ error: "Choose a SayPay @handle or a valid Nimiq address." }, { status: 400 });
  }
  if (recipientWallet === session.walletAddress) {
    return Response.json({ error: "You cannot schedule a payment to yourself." }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await db.insert(scheduledPayments).values({
    id,
    creatorWallet: session.walletAddress,
    recipientWallet,
    recipientHandle: recipientHandle || null,
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

  return Response.json({
    schedule: {
      id,
      amountLunas,
      note,
      runAt: runAtMs,
      recurrence,
      status: "scheduled",
      recipientHandle: recipientHandle || null,
      recipientWallet,
    },
  }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as {
    id?: string;
    action?: "cancel" | "complete";
    transactionReference?: string;
  };
  if (!payload.id || !payload.action) {
    return Response.json({ error: "A schedule id and action are required." }, { status: 400 });
  }
  const db = getDb();
  const [row] = await db.select().from(scheduledPayments).where(and(
    eq(scheduledPayments.id, payload.id),
    eq(scheduledPayments.creatorWallet, session.walletAddress),
  )).limit(1);
  if (!row) return Response.json({ error: "Schedule not found." }, { status: 404 });

  if (payload.action === "cancel") {
    if (!["scheduled", "due"].includes(row.status)) {
      return Response.json({ error: "This schedule cannot be cancelled." }, { status: 409 });
    }
    await db.update(scheduledPayments).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(eq(scheduledPayments.id, row.id));
    return Response.json({ ok: true, status: "cancelled" });
  }

  if (payload.action === "complete") {
    if (!["scheduled", "due"].includes(row.status)) {
      return Response.json({ error: "This schedule is not open for payment." }, { status: 409 });
    }
    const hash = payload.transactionReference?.trim().slice(0, 160) ?? null;
    await db.update(scheduledPayments).set({
      status: "completed",
      paidTransactionHash: hash,
      updatedAt: new Date().toISOString(),
    }).where(eq(scheduledPayments.id, row.id));
    await db.insert(activity).values({
      id: crypto.randomUUID(),
      walletAddress: session.walletAddress,
      kind: "schedule-payment",
      title: `Paid scheduled: ${row.note}`,
      amountLunas: row.amountLunas,
      status: "submitted",
      referenceId: row.id,
    });

    // Weekly recurrence: enqueue the next occurrence after pay.
    if (row.recurrence === "weekly") {
      const nextId = crypto.randomUUID();
      const nextRun = row.runAt + 7 * 24 * 60 * 60 * 1000;
      await db.insert(scheduledPayments).values({
        id: nextId,
        creatorWallet: row.creatorWallet,
        recipientWallet: row.recipientWallet,
        recipientHandle: row.recipientHandle,
        amountLunas: row.amountLunas,
        currency: row.currency,
        note: row.note,
        runAt: nextRun,
        recurrence: "weekly",
        status: "scheduled",
      });
    }
    return Response.json({ ok: true, status: "completed" });
  }

  return Response.json({ error: "Unknown schedule action." }, { status: 400 });
}
