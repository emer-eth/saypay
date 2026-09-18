import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { profiles, splitGroups, splitParticipants } from "../../../../db/schema";
import { requireSession, requireUser } from "../../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../../_lib/http";
import { persistLog } from "../../_lib/log";
import { recordConfirmedPayment } from "../../_lib/record-payment";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { id } = await Promise.resolve(params);
    const db = getDb();
    const [split] = await db.select().from(splitGroups).where(eq(splitGroups.id, id)).limit(1);
    if (!split) throw new HttpError(404, "This SayPay split was not found.", "not_found");
    const [creator] = await db.select({ handle: profiles.handle }).from(profiles).where(eq(profiles.walletAddress, split.creatorWallet)).limit(1);
    const session = await requireSession(request);
    const [participant] = session
      ? await db.select({
        shareLunas: splitParticipants.shareLunas,
        status: splitParticipants.status,
      }).from(splitParticipants).where(and(
        eq(splitParticipants.splitId, id),
        eq(splitParticipants.participantWallet, session.walletAddress),
      )).limit(1)
      : [];
    return jsonOk({
      split: {
        id: split.id,
        note: split.note,
        currency: split.currency,
        status: split.status,
        amountLunas: split.amountLunas,
        creatorWallet: split.creatorWallet,
        creatorHandle: creator?.handle ?? "saypay-user",
        participant: participant ?? null,
      },
    });
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
    const [split] = await db.select().from(splitGroups).where(eq(splitGroups.id, id)).limit(1);
    const [participant] = await db.select().from(splitParticipants).where(and(
      eq(splitParticipants.splitId, id),
      eq(splitParticipants.participantWallet, session.walletAddress),
    )).limit(1);
    if (!split || !participant) throw new HttpError(403, "This split is not assigned to your SayPay ID.", "forbidden");
    if (participant.status !== "pending") throw new HttpError(409, "Your share is already being processed.", "conflict");

    const recorded = await recordConfirmedPayment({
      senderWallet: session.walletAddress,
      recipientWallet: split.creatorWallet,
      amountLunas: participant.shareLunas,
      note: split.note,
      kind: "split-payment",
      hint: payload.transactionHint ?? payload.transactionReference,
      referenceId: split.id,
      activityTitle: `Paid split: ${split.note}`,
    });

    await db.update(splitParticipants).set({
      status: "paid",
      paidTransactionHash: recorded.txHash,
    }).where(eq(splitParticipants.id, participant.id));

    const remaining = await db.select().from(splitParticipants).where(and(
      eq(splitParticipants.splitId, split.id),
      eq(splitParticipants.status, "pending"),
    ));
    if (remaining.length === 0) {
      await db.update(splitGroups).set({ status: "settled" }).where(eq(splitGroups.id, split.id));
    }
    await persistLog("info", "split_share_paid", { wallet: session.walletAddress, id: split.id, txHash: recorded.txHash });
    return jsonOk({ ok: true, status: "paid", txHash: recorded.txHash, confirmations: recorded.confirmations });
  } catch (error) {
    return jsonError(error);
  }
}
