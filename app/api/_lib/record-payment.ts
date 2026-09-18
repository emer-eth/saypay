import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { activity, payments } from "../../../db/schema";
import { HttpError } from "./http";
import { persistLog } from "./log";
import { verifyPayment } from "./nimiq-rpc";

export async function recordConfirmedPayment(options: {
  senderWallet: string;
  recipientWallet: string;
  amountLunas: number;
  note?: string;
  kind?: string;
  hint?: string;
  sourceUtterance?: string;
  referenceId?: string;
  activityTitle: string;
}) {
  const check = await verifyPayment({
    hint: options.hint,
    expectedFrom: options.senderWallet,
    expectedTo: options.recipientWallet,
    expectedValueLunas: options.amountLunas,
  });

  if (check.status === "mismatch") {
    throw new HttpError(400, check.reason ?? "That transaction does not match this payment.", "tx_mismatch");
  }
  if (check.status !== "ok" || !check.tx) {
    throw new HttpError(409, check.reason ?? "The Nimiq node has not confirmed this transaction yet. Retry in a few seconds.", "tx_unconfirmed");
  }

  const txHash = check.tx.hash;
  const db = getDb();
  const [existing] = await db.select({ id: payments.id }).from(payments).where(eq(payments.txHash, txHash)).limit(1);
  if (existing) {
    return { id: existing.id, txHash, confirmations: check.tx.confirmations ?? 0, replay: true };
  }

  const id = crypto.randomUUID();
  await db.insert(payments).values({
    id,
    senderWallet: options.senderWallet,
    recipientWallet: options.recipientWallet,
    amountLunas: options.amountLunas,
    note: options.note?.slice(0, 120) ?? "",
    txHash,
    status: "confirmed",
    kind: options.kind ?? "send",
    sourceUtterance: options.sourceUtterance?.slice(0, 500) ?? null,
    referenceId: options.referenceId ?? null,
    confirmations: check.tx.confirmations ?? 0,
  });
  await db.insert(activity).values({
    id: crypto.randomUUID(),
    walletAddress: options.senderWallet,
    kind: options.kind ?? "payment",
    title: options.activityTitle.slice(0, 120),
    amountLunas: options.amountLunas,
    status: "confirmed",
    referenceId: txHash,
  });
  await persistLog("info", "payment_confirmed", {
    wallet: options.senderWallet,
    txHash,
    amountLunas: options.amountLunas,
    kind: options.kind ?? "send",
  });
  return { id, txHash, confirmations: check.tx.confirmations ?? 0, replay: false };
}
