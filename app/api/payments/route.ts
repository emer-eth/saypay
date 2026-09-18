import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { payments } from "../../../db/schema";
import { isValidNimiqAddress } from "../../_lib/units";
import { normaliseAddress, requireUser } from "../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../_lib/http";
import { requireLunas } from "../_lib/money";
import { profileByHandle } from "../_lib/people";
import { recordConfirmedPayment } from "../_lib/record-payment";

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const rows = await db.select().from(payments).where(eq(payments.senderWallet, session.walletAddress)).orderBy(desc(payments.createdAt)).limit(50);
    return jsonOk({ payments: rows });
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
      transactionHint?: string;
      sourceUtterance?: string;
      kind?: string;
      referenceId?: string;
    }>(request);

    let recipientWallet = payload.recipientWallet ? normaliseAddress(payload.recipientWallet) : "";
    if (payload.recipientHandle) {
      const profile = await profileByHandle(payload.recipientHandle);
      recipientWallet = profile.walletAddress;
    }
    if (!isValidNimiqAddress(recipientWallet)) {
      throw new HttpError(400, "Choose a SayPay @handle or a valid Nimiq address.", "invalid_recipient");
    }
    if (recipientWallet === session.walletAddress) {
      throw new HttpError(400, "You cannot pay yourself.", "self_pay");
    }
    const amountLunas = requireLunas(payload.amount);
    const recorded = await recordConfirmedPayment({
      senderWallet: session.walletAddress,
      recipientWallet,
      amountLunas,
      note: payload.note,
      kind: payload.kind ?? "send",
      hint: payload.transactionHint,
      sourceUtterance: payload.sourceUtterance,
      referenceId: payload.referenceId,
      activityTitle: `Sent ${payload.amount} NIM`,
    });
    return jsonOk({ payment: recorded }, recorded.replay ? 200 : 201);
  } catch (error) {
    return jsonError(error);
  }
}
