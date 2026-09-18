import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { paymentRequests } from "../../../../db/schema";
import { requireUser } from "../../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../../_lib/http";
import { handlesForWallets, linesForRequests, presentRequest } from "../../_lib/invoices";
import { persistLog } from "../../_lib/log";
import { recordConfirmedPayment } from "../../_lib/record-payment";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { id } = await Promise.resolve(params);
    if (!id) throw new HttpError(404, "This SayPay request was not found.", "not_found");
    const db = getDb();
    const [item] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, id)).limit(1);
    if (!item) throw new HttpError(404, "This SayPay request was not found.", "not_found");
    const lineMap = await linesForRequests([item.id]);
    const handles = await handlesForWallets([item.creatorWallet, item.recipientWallet]);
    return jsonOk({ request: presentRequest(item, lineMap.get(item.id) ?? [], handles) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const session = await requireUser(request);
    const { id } = await Promise.resolve(params);
    const payload = await readJson<{ transactionHint?: string; transactionReference?: string }>(request);
    const db = getDb();
    const [item] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, id)).limit(1);
    if (!item || item.recipientWallet !== session.walletAddress) {
      throw new HttpError(403, "This request is not assigned to your SayPay ID.", "forbidden");
    }
    if (item.status !== "open") throw new HttpError(409, "This request is already being processed.", "conflict");

    const recorded = await recordConfirmedPayment({
      senderWallet: session.walletAddress,
      recipientWallet: item.creatorWallet,
      amountLunas: item.amountLunas,
      note: item.note,
      kind: "request-payment",
      hint: payload.transactionHint ?? payload.transactionReference,
      referenceId: item.id,
      activityTitle: `Paid request: ${item.note}`,
    });

    await db.update(paymentRequests).set({
      status: "paid",
      paidTransactionHash: recorded.txHash,
      updatedAt: new Date().toISOString(),
    }).where(eq(paymentRequests.id, item.id));
    await persistLog("info", "request_paid", { wallet: session.walletAddress, id: item.id, txHash: recorded.txHash });
    return jsonOk({ ok: true, status: "paid", txHash: recorded.txHash, confirmations: recorded.confirmations });
  } catch (error) {
    return jsonError(error);
  }
}
