import { and, desc, eq } from "drizzle-orm";
import { lunasToNim } from "../../_lib/units";
import { getDb } from "../../../db";
import { timeEntries } from "../../../db/schema";
import { requireUser } from "../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../_lib/http";
import { createInvoice } from "../_lib/invoices";
import { persistLog } from "../_lib/log";
import { requireLunas } from "../_lib/money";
import { profileByHandle } from "../_lib/people";
import { formatHours, timerBill } from "../_lib/work";

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const entries = await db.select().from(timeEntries)
      .where(eq(timeEntries.walletAddress, session.walletAddress))
      .orderBy(desc(timeEntries.startedAt));
    return jsonOk({
      timer: entries.find((row) => row.status === "running") ?? null,
      entries,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{
      action?: "start" | "stop" | "invoice";
      id?: string;
      clientHandle?: string;
      description?: string;
      rateNimPerHour?: number;
      dueAt?: string;
    }>(request);
    const db = getDb();

    if (payload.action === "start") {
      const [running] = await db.select().from(timeEntries).where(and(
        eq(timeEntries.walletAddress, session.walletAddress),
        eq(timeEntries.status, "running"),
      )).limit(1);
      if (running) throw new HttpError(409, "Stop the running timer before starting another.", "timer_running");
      const client = await profileByHandle(payload.clientHandle ?? "");
      if (client.walletAddress === session.walletAddress) {
        throw new HttpError(400, "Track time against a client, not yourself.", "self_timer");
      }
      const rateLunasPerHour = requireLunas(payload.rateNimPerHour, "Set an hourly rate in NIM.");
      const id = crypto.randomUUID();
      const startedAt = Date.now();
      const description = payload.description?.trim().slice(0, 120) ?? "";
      await db.insert(timeEntries).values({
        id,
        walletAddress: session.walletAddress,
        clientWallet: client.walletAddress,
        clientHandle: client.handle,
        description,
        rateLunasPerHour,
        startedAt,
        status: "running",
      });
      await persistLog("info", "timer_started", { wallet: session.walletAddress, id, client: client.handle });
      return jsonOk({
        timer: { id, clientHandle: client.handle, description, rateLunasPerHour, startedAt, status: "running" },
      }, 201);
    }

    if (payload.action === "stop" || payload.action === "invoice") {
      const entry = await loadEntry(session.walletAddress, payload.id);
      const endedAt = entry.endedAt ?? Date.now();
      const durationMs = Math.max(1, endedAt - entry.startedAt);
      if (entry.status === "running") {
        await db.update(timeEntries).set({
          status: "stopped",
          endedAt,
          durationMs,
        }).where(eq(timeEntries.id, entry.id));
      }
      const stopped = {
        ...entry,
        status: "stopped" as const,
        endedAt: entry.endedAt ?? endedAt,
        durationMs: entry.durationMs ?? durationMs,
      };
      if (payload.action === "stop") {
        await persistLog("info", "timer_stopped", { wallet: session.walletAddress, id: entry.id, durationMs: stopped.durationMs });
        return jsonOk({ timer: stopped });
      }

      if (entry.status === "invoiced" && entry.invoiceId) {
        throw new HttpError(409, "That time is already on an invoice.", "already_invoiced");
      }
      const bill = timerBill(stopped.durationMs ?? durationMs, entry.rateLunasPerHour);
      if (!bill) throw new HttpError(400, "That timer is too short to invoice.", "timer_too_short");
      const hours = formatHours(stopped.durationMs ?? durationMs);
      const note = entry.description
        ? `${hours}h × ${lunasToNim(entry.rateLunasPerHour)} NIM/h — ${entry.description}`
        : `${hours}h × ${lunasToNim(entry.rateLunasPerHour)} NIM/h`;
      const invoice = await createInvoice({
        creatorWallet: session.walletAddress,
        recipientHandle: entry.clientHandle,
        note,
        dueAt: payload.dueAt,
        amountLunas: bill.amountLunas,
        lineItems: [{
          description: note,
          quantity: bill.hours,
          unitNim: lunasToNim(entry.rateLunasPerHour),
        }],
      });
      await db.update(timeEntries).set({
        status: "invoiced",
        endedAt: stopped.endedAt,
        durationMs: stopped.durationMs,
        invoiceId: invoice.id,
      }).where(eq(timeEntries.id, entry.id));
      await persistLog("info", "timer_invoiced", { wallet: session.walletAddress, id: entry.id, invoiceId: invoice.id });
      return jsonOk({ timer: { ...stopped, status: "invoiced", invoiceId: invoice.id }, invoice }, 201);
    }

    throw new HttpError(400, "Choose start, stop, or invoice.", "unknown_action");
  } catch (error) {
    return jsonError(error);
  }
}

async function loadEntry(wallet: string, id?: string) {
  const db = getDb();
  if (id) {
    const [row] = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
    if (!row || row.walletAddress !== wallet) throw new HttpError(404, "Timer not found.", "not_found");
    return row;
  }
  const [running] = await db.select().from(timeEntries).where(and(
    eq(timeEntries.walletAddress, wallet),
    eq(timeEntries.status, "running"),
  )).limit(1);
  if (running) return running;
  const [stopped] = await db.select().from(timeEntries).where(and(
    eq(timeEntries.walletAddress, wallet),
    eq(timeEntries.status, "stopped"),
  )).orderBy(desc(timeEntries.startedAt)).limit(1);
  if (!stopped) throw new HttpError(404, "No timer to bill. Start one first.", "not_found");
  return stopped;
}
