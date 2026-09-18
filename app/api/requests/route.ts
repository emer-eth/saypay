import { desc, eq, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { paymentRequests } from "../../../db/schema";
import { requireUser } from "../_lib/auth";
import { createInvoice, handlesForWallets, linesForRequests, presentRequest, type LineInput } from "../_lib/invoices";
import { jsonError, jsonOk, readJson, HttpError } from "../_lib/http";

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const requests = await db.select().from(paymentRequests).where(or(
      eq(paymentRequests.creatorWallet, session.walletAddress),
      eq(paymentRequests.recipientWallet, session.walletAddress),
    )).orderBy(desc(paymentRequests.createdAt));
    const lineMap = await linesForRequests(requests.map((row) => row.id));
    const handles = await handlesForWallets(requests.flatMap((row) => [row.creatorWallet, row.recipientWallet]));
    return jsonOk({
      requests: requests.map((row) => presentRequest(row, lineMap.get(row.id) ?? [], handles)),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{
      recipientHandle?: string;
      amount?: number;
      note?: string;
      dueAt?: string;
      kind?: "request" | "invoice";
      lineItems?: LineInput[];
    }>(request);
    const created = await createInvoice({
      creatorWallet: session.walletAddress,
      recipientHandle: payload.recipientHandle ?? "",
      note: payload.note,
      dueAt: payload.dueAt,
      kind: payload.kind === "request" ? "request" : "invoice",
      lineItems: payload.lineItems,
      amountNim: payload.amount,
    });
    return jsonOk({ request: created }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{ id?: string; status?: "declined" | "cancelled" }>(request);
    if (!payload.id || !payload.status) throw new HttpError(400, "A request and status are required.", "missing_fields");
    const db = getDb();
    const [item] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, payload.id)).limit(1);
    if (!item || (item.creatorWallet !== session.walletAddress && item.recipientWallet !== session.walletAddress)) {
      throw new HttpError(404, "Request not found.", "not_found");
    }
    if (item.status !== "open") throw new HttpError(409, "This request is no longer open.", "conflict");
    await db.update(paymentRequests).set({ status: payload.status, updatedAt: new Date().toISOString() }).where(eq(paymentRequests.id, item.id));
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
