import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { activity, paymentRequests, payments, profiles } from "../../../../db/schema";
import { verifyUsdtTransfer } from "../../_lib/polygon";
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
    const payload = await readJson<{ transactionHint?: string; transactionReference?: string; asset?: "NIM" | "USDT"; txHash?: string }>(request);
    const db = getDb();
    const [item] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, id)).limit(1);
    if (!item || item.recipientWallet !== session.walletAddress) {
      throw new HttpError(403, "This request is not assigned to your SayPay ID.", "forbidden");
    }
    if (item.status !== "open") throw new HttpError(409, "This request is already being processed.", "conflict");

    // Fiat-priced invoices are paid against the quote the payer locked on the pay page.
    const fiat = item.priceCurrency != null && item.priceCents != null;
    const quoteUsable = item.quoteExpiresAt != null && Date.now() - Date.parse(item.quoteExpiresAt) < 30 * 60_000;
    if (fiat && !quoteUsable) throw new HttpError(409, "The price quote expired. Reopen the invoice to get a fresh one.", "quote_expired");

    if (payload.asset === "USDT") {
      if (item.acceptsUsdt !== 1 || !item.quoteUsdtMicro) throw new HttpError(400, "This invoice isn't payable in USDT.", "usdt_not_accepted");
      const [creator] = await db.select({ evmAddress: profiles.evmAddress }).from(profiles).where(eq(profiles.walletAddress, item.creatorWallet)).limit(1);
      if (!creator?.evmAddress) throw new HttpError(400, "The invoice's sender has no Polygon address on file.", "usdt_no_address");
      const check = await verifyUsdtTransfer({ txHash: payload.txHash ?? "", payee: creator.evmAddress, minMicro: item.quoteUsdtMicro });
      if (check.status === "mismatch") throw new HttpError(400, check.reason, "tx_mismatch");
      if (check.status === "pending") throw new HttpError(409, check.reason, "tx_unconfirmed");
      // One transaction can settle one invoice: the hash is unique in payments.
      const [used] = await db.select({ id: payments.id }).from(payments).where(eq(payments.txHash, check.txHash)).limit(1);
      if (used) throw new HttpError(409, "That USDT transfer was already used for a payment.", "tx_reused");
      await db.insert(payments).values({
        id: crypto.randomUUID(),
        senderWallet: session.walletAddress,
        recipientWallet: item.creatorWallet,
        amountLunas: check.valueMicro, // micro-USDT for currency USDT (6 decimals), not lunas
        currency: "USDT",
        note: item.note.slice(0, 120),
        txHash: check.txHash,
        status: "confirmed",
        kind: "request-payment",
        referenceId: item.id,
        confirmations: check.confirmations,
      });
      await db.insert(activity).values({
        id: crypto.randomUUID(),
        walletAddress: session.walletAddress,
        kind: "request-payment",
        title: `Paid ${(check.valueMicro / 1e6).toFixed(2)} USDT: ${item.note}`.slice(0, 120),
        amountLunas: null,
        status: "confirmed",
        referenceId: check.txHash,
      });
      await db.update(paymentRequests).set({ status: "paid", paidAsset: "USDT", paidTransactionHash: check.txHash, updatedAt: new Date().toISOString() }).where(eq(paymentRequests.id, item.id));
      await persistLog("info", "request_paid", { wallet: session.walletAddress, id: item.id, txHash: check.txHash, asset: "USDT" });
      return jsonOk({ ok: true, status: "paid", txHash: check.txHash, confirmations: check.confirmations, asset: "USDT" });
    }

    const recorded = await recordConfirmedPayment({
      senderWallet: session.walletAddress,
      recipientWallet: item.creatorWallet,
      amountLunas: fiat ? (item.quoteLunas ?? item.amountLunas) : item.amountLunas,
      note: item.note,
      kind: "request-payment",
      hint: payload.transactionHint ?? payload.transactionReference,
      referenceId: item.id,
      activityTitle: `Paid request: ${item.note}`,
    });

    await db.update(paymentRequests).set({
      status: "paid",
      paidAsset: "NIM",
      paidTransactionHash: recorded.txHash,
      updatedAt: new Date().toISOString(),
    }).where(eq(paymentRequests.id, item.id));
    await persistLog("info", "request_paid", { wallet: session.walletAddress, id: item.id, txHash: recorded.txHash });
    return jsonOk({ ok: true, status: "paid", txHash: recorded.txHash, confirmations: recorded.confirmations });
  } catch (error) {
    return jsonError(error);
  }
}
