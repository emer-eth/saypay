import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { payments, profiles, workEscrowEvidence, workEscrowVotes, workEscrows } from "../../../../db/schema";
import { isValidNimiqAddress, lunasToNim } from "../../../_lib/units";
import { requireUser } from "../../_lib/auth";
import { aiEscrowDecide } from "../../_lib/ai-escrow";
import { resolveEscrowVotes, type EscrowVote } from "../../_lib/escrow-resolve";
import { jsonError, jsonOk, readJson, HttpError } from "../../_lib/http";
import { createInvoice, handlesForWallets } from "../../_lib/invoices";
import { persistLog } from "../../_lib/log";
import { getAccount, verifyOutgoing } from "../../_lib/nimiq-rpc";
import { profileByHandle } from "../../_lib/people";
import { recordConfirmedPayment } from "../../_lib/record-payment";

type Action = "accept" | "dispute" | "vote" | "add_evidence" | "ask_ai" | "fund" | "release" | "refund" | "pay_direct" | "invoice_stage";

function canSee(wallet: string, row: typeof workEscrows.$inferSelect) {
  return [
    row.creatorWallet,
    row.counterpartyWallet,
    row.creatorEscrowWallet,
    row.counterpartyEscrowWallet,
  ].includes(wallet);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const session = await requireUser(request);
    const { id } = await Promise.resolve(params);
    const payload = await readJson<{
      action?: Action;
      escrowHandle?: string;
      vote?: EscrowVote;
      body?: string;
      transactionHint?: string;
      contractAddress?: string;
      hashRoot?: string;
      timeoutBlock?: number;
    }>(request);
    const db = getDb();
    const [row] = await db.select().from(workEscrows).where(eq(workEscrows.id, id)).limit(1);
    if (!row) throw new HttpError(404, "This escrow was not found.", "not_found");
    if (!canSee(session.walletAddress, row)) throw new HttpError(403, "This escrow is not yours.", "forbidden");

    if (payload.action === "accept") {
      if (row.counterpartyWallet !== session.walletAddress || row.status !== "offered") {
        throw new HttpError(409, "Only the invited party can accept and name their escrow.", "conflict");
      }
      const escrow = await profileByHandle(payload.escrowHandle ?? "");
      const blocked = [row.creatorWallet, row.counterpartyWallet, row.creatorEscrowWallet];
      if (blocked.includes(escrow.walletAddress)) {
        throw new HttpError(400, "Your escrow must be a third SayPay ID — not either party or their escrow.", "escrow_party");
      }
      await db.update(workEscrows).set({
        counterpartyEscrowWallet: escrow.walletAddress,
        status: "accepted",
        updatedAt: new Date().toISOString(),
      }).where(eq(workEscrows.id, row.id));
      await persistLog("info", "escrow_accepted", { wallet: session.walletAddress, id: row.id });
      return jsonOk({ ok: true, status: "accepted" });
    }

    if (payload.action === "dispute") {
      if (![row.creatorWallet, row.counterpartyWallet].includes(session.walletAddress)) {
        throw new HttpError(403, "Only a party can open a dispute.", "forbidden");
      }
      if (!["accepted", "funded"].includes(row.status)) {
        throw new HttpError(409, "A dispute can only be opened on an active escrow.", "conflict");
      }
      await db.update(workEscrows).set({ status: "disputed", updatedAt: new Date().toISOString() }).where(eq(workEscrows.id, row.id));
      await persistLog("info", "escrow_disputed", { wallet: session.walletAddress, id: row.id });
      return jsonOk({ ok: true, status: "disputed" });
    }

    if (payload.action === "add_evidence") {
      const body = payload.body?.trim().slice(0, 1_000) ?? "";
      if (!body) throw new HttpError(400, "Write a short evidence note.", "bad_evidence");
      if (![row.creatorWallet, row.counterpartyWallet].includes(session.walletAddress)) {
        throw new HttpError(403, "Only a party can add evidence.", "forbidden");
      }
      await db.insert(workEscrowEvidence).values({
        id: crypto.randomUUID(),
        escrowId: row.id,
        authorWallet: session.walletAddress,
        body,
      });
      return jsonOk({ ok: true });
    }

    if (payload.action === "vote") {
      const role = session.walletAddress === row.creatorEscrowWallet
        ? "creator_escrow"
        : session.walletAddress === row.counterpartyEscrowWallet
          ? "counterparty_escrow"
          : null;
      if (!role || !payload.vote || (payload.vote !== "release" && payload.vote !== "refund")) {
        throw new HttpError(403, "Only a nominated escrow can vote release or refund.", "forbidden");
      }
      if (!["accepted", "funded", "disputed"].includes(row.status)) {
        throw new HttpError(409, "Escrows vote after both parties have accepted.", "conflict");
      }
      const [existing] = await db.select().from(workEscrowVotes).where(and(
        eq(workEscrowVotes.escrowId, row.id),
        eq(workEscrowVotes.walletAddress, session.walletAddress),
      )).limit(1);
      if (existing) {
        await db.update(workEscrowVotes).set({ vote: payload.vote }).where(eq(workEscrowVotes.id, existing.id));
      } else {
        await db.insert(workEscrowVotes).values({
          id: crypto.randomUUID(),
          escrowId: row.id,
          walletAddress: session.walletAddress,
          role,
          vote: payload.vote,
        });
      }
      const resolution = await settleVotes(row.id);
      await persistLog("info", "escrow_vote", { wallet: session.walletAddress, id: row.id, vote: payload.vote, resolution: resolution.status });
      return jsonOk({ ok: true, ...resolution, note: "Escrow votes do not move NIM. A funded HTLC or a signed payment still has to happen in Nimiq Pay." });
    }

    if (payload.action === "ask_ai") {
      const resolution = await settleVotes(row.id, { forceAi: true });
      return jsonOk({ ok: true, ...resolution });
    }

    if (payload.action === "invoice_stage") {
      if (row.counterpartyWallet !== session.walletAddress || !["accepted", "release_recommended"].includes(row.status)) {
        throw new HttpError(409, "Only the worker can invoice after terms are accepted.", "conflict");
      }
      const [client] = await db.select({ handle: profiles.handle }).from(profiles).where(eq(profiles.walletAddress, row.creatorWallet)).limit(1);
      if (!client) throw new HttpError(404, "The client no longer has a SayPay ID.", "not_found");
      const invoice = await createInvoice({
        creatorWallet: session.walletAddress,
        recipientHandle: client.handle,
        note: row.description,
        amountLunas: row.amountLunas,
        jobId: row.id,
      });
      await db.update(workEscrows).set({ status: "invoiced", updatedAt: new Date().toISOString() }).where(eq(workEscrows.id, row.id));
      return jsonOk({ ok: true, status: "invoiced", invoice });
    }

    if (payload.action === "pay_direct") {
      if (row.creatorWallet !== session.walletAddress || !["accepted", "release_recommended"].includes(row.status)) {
        throw new HttpError(409, "Only the client can pay after terms are accepted.", "conflict");
      }
      const recorded = await recordConfirmedPayment({
        senderWallet: session.walletAddress,
        recipientWallet: row.counterpartyWallet,
        amountLunas: row.amountLunas,
        note: row.description,
        kind: "escrow-direct",
        hint: payload.transactionHint,
        referenceId: row.id,
        activityTitle: `Paid escrow: ${row.description}`,
      });
      await db.update(workEscrows).set({
        status: "paid_direct",
        escrowTransactionHash: recorded.txHash,
        updatedAt: new Date().toISOString(),
      }).where(eq(workEscrows.id, row.id));
      return jsonOk({ ok: true, status: "paid_direct", txHash: recorded.txHash });
    }

    if (payload.action === "fund") {
      if (row.creatorWallet !== session.walletAddress || row.status !== "accepted") {
        throw new HttpError(409, "Only the client can lock NIM after both sides accept.", "conflict");
      }
      const check = await verifyOutgoing({
        hint: payload.transactionHint,
        expectedFrom: session.walletAddress,
        expectedValueLunas: row.amountLunas,
      });
      if (check.status === "mismatch") throw new HttpError(400, check.reason ?? "That transaction does not match this escrow.", "tx_mismatch");
      if (check.status !== "ok" || !check.tx) {
        throw new HttpError(409, check.reason ?? "The HTLC transaction is not confirmed yet.", "tx_unconfirmed");
      }
      const contract = (payload.contractAddress ?? check.tx.to ?? "").replace(/\s/g, "").toUpperCase();
      if (!isValidNimiqAddress(contract)) {
        throw new HttpError(400, "Could not read the HTLC contract address from the confirmed transaction.", "missing_contract");
      }
      const account = await getAccount(contract);
      if (account?.type && /^(basic|vesting|staker|staking|validator)$/i.test(account.type)) {
        throw new HttpError(400, `That address is a ${account.type} account, not an HTLC. Funds were not recorded as locked.`, "not_htlc");
      }
      const [existingPay] = await db.select({ id: payments.id }).from(payments).where(eq(payments.txHash, check.tx.hash)).limit(1);
      if (!existingPay) {
        await db.insert(payments).values({
          id: crypto.randomUUID(),
          senderWallet: session.walletAddress,
          recipientWallet: contract,
          amountLunas: row.amountLunas,
          note: row.description,
          txHash: check.tx.hash,
          status: "confirmed",
          kind: "escrow-fund",
          referenceId: row.id,
          confirmations: check.tx.confirmations ?? 0,
        });
      }
      await db.update(workEscrows).set({
        status: "funded",
        htlcContractAddress: contract,
        hashRoot: payload.hashRoot ?? null,
        timeoutBlock: payload.timeoutBlock ?? null,
        escrowTransactionHash: check.tx.hash,
        updatedAt: new Date().toISOString(),
      }).where(eq(workEscrows.id, row.id));
      return jsonOk({ ok: true, status: "funded", txHash: check.tx.hash });
    }

    if (payload.action === "release" || payload.action === "refund") {
      if (!row.htlcContractAddress) throw new HttpError(409, "There is no funded HTLC to settle.", "conflict");
      const recipient = payload.action === "release" ? row.counterpartyWallet : row.creatorWallet;
      const recorded = await recordConfirmedPayment({
        senderWallet: row.htlcContractAddress,
        recipientWallet: recipient,
        amountLunas: row.amountLunas,
        note: row.description,
        kind: payload.action === "release" ? "escrow-release" : "escrow-refund",
        hint: payload.transactionHint,
        referenceId: row.id,
        activityTitle: payload.action === "release" ? `Released escrow: ${row.description}` : `Refunded escrow: ${row.description}`,
      });
      const status = payload.action === "release" ? "released" : "refunded";
      await db.update(workEscrows).set({ status, updatedAt: new Date().toISOString() }).where(eq(workEscrows.id, row.id));
      await persistLog("info", "escrow_settled", { wallet: session.walletAddress, id: row.id, status, txHash: recorded.txHash });
      return jsonOk({ ok: true, status, txHash: recorded.txHash });
    }

    throw new HttpError(400, "Choose an escrow action.", "unknown_action");
  } catch (error) {
    return jsonError(error);
  }
}

async function settleVotes(id: string, options: { forceAi?: boolean } = {}) {
  const db = getDb();
  const [row] = await db.select().from(workEscrows).where(eq(workEscrows.id, id)).limit(1);
  if (!row) throw new HttpError(404, "This escrow was not found.", "not_found");
  const votes = await db.select().from(workEscrowVotes).where(eq(workEscrowVotes.escrowId, id));
  const creatorVote = (votes.find((vote) => vote.role === "creator_escrow")?.vote ?? null) as EscrowVote | null;
  const counterVote = (votes.find((vote) => vote.role === "counterparty_escrow")?.vote ?? null) as EscrowVote | null;
  let aiVote = (row.aiVote === "release" || row.aiVote === "refund" ? row.aiVote : null) as EscrowVote | null;
  let resolution = resolveEscrowVotes({ creatorEscrowVote: creatorVote, counterpartyEscrowVote: counterVote, aiVote });

  if (resolution.status === "needs_ai" || (options.forceAi && creatorVote && counterVote && creatorVote !== counterVote && !aiVote)) {
    const evidence = await db.select().from(workEscrowEvidence).where(eq(workEscrowEvidence.escrowId, id));
    const handles = await handlesForWallets(evidence.map((item) => item.authorWallet));
    const decided = await aiEscrowDecide({
      terms: row.description,
      amountNim: lunasToNim(row.amountLunas),
      evidence: evidence.map((item) => ({ author: `@${handles.get(item.authorWallet) ?? "user"}`, body: item.body })),
      creatorEscrowVote: creatorVote!,
      counterpartyEscrowVote: counterVote!,
    });
    if (!decided.ok) {
      return { status: "needs_ai" as const, winner: null, vote: null, ai: decided };
    }
    aiVote = decided.vote;
    await db.update(workEscrows).set({
      aiVote: decided.vote,
      aiReason: decided.reason,
      updatedAt: new Date().toISOString(),
    }).where(eq(workEscrows.id, id));
    resolution = resolveEscrowVotes({ creatorEscrowVote: creatorVote, counterpartyEscrowVote: counterVote, aiVote });
  }

  if (resolution.status === "release_recommended" || resolution.status === "refund_recommended") {
    await db.update(workEscrows).set({ status: resolution.status, updatedAt: new Date().toISOString() }).where(eq(workEscrows.id, id));
  }
  return resolution;
}
