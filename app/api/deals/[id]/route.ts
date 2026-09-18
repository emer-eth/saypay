import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { activity, dealArbiters, dealEvidence, payments, profiles, protectedDeals } from "../../../../db/schema";
import { isValidNimiqAddress } from "../../../_lib/units";
import { requireUser } from "../../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../../_lib/http";
import { createInvoice } from "../../_lib/invoices";
import { persistLog } from "../../_lib/log";
import { getAccount, verifyOutgoing } from "../../_lib/nimiq-rpc";
import { recordConfirmedPayment } from "../../_lib/record-payment";

type DealAction = "accept" | "fund" | "release" | "refund" | "open_dispute" | "vote" | "add_evidence" | "invoice_stage" | "pay_direct";

function canSee(wallet: string, deal: typeof protectedDeals.$inferSelect, arbiterWallets: string[]) {
  return deal.creatorWallet === wallet || deal.counterpartyWallet === wallet || arbiterWallets.includes(wallet);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const session = await requireUser(request);
    const { id } = await Promise.resolve(params);
    const db = getDb();
    const [deal] = await db.select().from(protectedDeals).where(eq(protectedDeals.id, id)).limit(1);
    if (!deal) throw new HttpError(404, "This protected deal was not found.", "not_found");
    const arbiters = await db.select().from(dealArbiters).where(eq(dealArbiters.dealId, id));
    if (!canSee(session.walletAddress, deal, arbiters.map((a) => a.walletAddress))) {
      throw new HttpError(403, "This protected deal is not assigned to your SayPay ID.", "forbidden");
    }
    const evidence = await db.select().from(dealEvidence).where(eq(dealEvidence.dealId, id));
    const walletIds = [...new Set([
      deal.creatorWallet,
      deal.counterpartyWallet,
      ...arbiters.map((a) => a.walletAddress),
      ...evidence.map((e) => e.authorWallet),
    ])];
    const people = await db.select({ walletAddress: profiles.walletAddress, handle: profiles.handle }).from(profiles).where(inArray(profiles.walletAddress, walletIds));
    const handles = new Map(people.map((p) => [p.walletAddress, p.handle]));
    return jsonOk({
      deal: {
        ...deal,
        creatorHandle: handles.get(deal.creatorWallet) ?? "saypay-user",
        counterpartyHandle: handles.get(deal.counterpartyWallet) ?? "saypay-user",
      },
      arbiters: arbiters.map((a) => ({ ...a, handle: handles.get(a.walletAddress) ?? "saypay-user" })),
      evidence: evidence.map((e) => ({ ...e, authorHandle: handles.get(e.authorWallet) ?? "saypay-user" })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const session = await requireUser(request);
    const { id } = await Promise.resolve(params);
    const payload = await readJson<{
      action?: DealAction;
      vote?: "release" | "refund";
      body?: string;
      transactionHint?: string;
      contractAddress?: string;
      hashRoot?: string;
      timeoutBlock?: number;
    }>(request);
    const db = getDb();
    const [deal] = await db.select().from(protectedDeals).where(eq(protectedDeals.id, id)).limit(1);
    if (!deal) throw new HttpError(404, "This protected deal was not found.", "not_found");
    const arbiters = await db.select().from(dealArbiters).where(eq(dealArbiters.dealId, id));
    const arbiterWallets = arbiters.map((a) => a.walletAddress);
    if (!canSee(session.walletAddress, deal, arbiterWallets)) {
      throw new HttpError(403, "This protected deal is not assigned to your SayPay ID.", "forbidden");
    }
    const isParty = deal.creatorWallet === session.walletAddress || deal.counterpartyWallet === session.walletAddress;
    const myArbiter = arbiters.find((a) => a.walletAddress === session.walletAddress);

    if (payload.action === "accept") {
      if (deal.counterpartyWallet !== session.walletAddress || deal.status !== "offered") {
        throw new HttpError(409, "Only the invited counterparty can accept an offered deal.", "conflict");
      }
      await db.update(protectedDeals).set({ status: "terms_accepted", updatedAt: new Date().toISOString() }).where(eq(protectedDeals.id, deal.id));
      await db.insert(activity).values({
        id: crypto.randomUUID(),
        walletAddress: session.walletAddress,
        kind: "deal",
        title: `Accepted protected deal: ${deal.description}`,
        amountLunas: deal.amountLunas,
        status: "terms_accepted",
        referenceId: deal.id,
      });
      await persistLog("info", "deal_accepted", { wallet: session.walletAddress, id: deal.id });
      return jsonOk({ ok: true, status: "terms_accepted" });
    }

    if (payload.action === "invoice_stage") {
      if (deal.counterpartyWallet !== session.walletAddress || deal.status !== "terms_accepted") {
        throw new HttpError(409, "Only the worker can invoice a stage after terms are accepted.", "conflict");
      }
      const [client] = await db.select({ handle: profiles.handle }).from(profiles).where(eq(profiles.walletAddress, deal.creatorWallet)).limit(1);
      if (!client) throw new HttpError(404, "The client no longer has a SayPay ID.", "not_found");
      const invoice = await createInvoice({
        creatorWallet: session.walletAddress,
        recipientHandle: client.handle,
        note: deal.description,
        amountLunas: deal.amountLunas,
        jobId: deal.id,
      });
      await db.update(protectedDeals).set({ status: "invoiced", updatedAt: new Date().toISOString() }).where(eq(protectedDeals.id, deal.id));
      await persistLog("info", "deal_invoiced", { wallet: session.walletAddress, id: deal.id, invoiceId: invoice.id });
      return jsonOk({ ok: true, status: "invoiced", invoice });
    }

    if (payload.action === "pay_direct") {
      if (deal.creatorWallet !== session.walletAddress || deal.status !== "terms_accepted") {
        throw new HttpError(409, "Only the client can pay a stage directly after terms are accepted.", "conflict");
      }
      const recorded = await recordConfirmedPayment({
        senderWallet: session.walletAddress,
        recipientWallet: deal.counterpartyWallet,
        amountLunas: deal.amountLunas,
        note: deal.description,
        kind: "job-direct",
        hint: payload.transactionHint,
        referenceId: deal.id,
        activityTitle: `Paid job: ${deal.description}`,
      });
      await db.update(protectedDeals).set({
        status: "paid_direct",
        escrowTransactionHash: recorded.txHash,
        updatedAt: new Date().toISOString(),
      }).where(eq(protectedDeals.id, deal.id));
      await persistLog("info", "deal_paid_direct", { wallet: session.walletAddress, id: deal.id, txHash: recorded.txHash });
      return jsonOk({ ok: true, status: "paid_direct", txHash: recorded.txHash, confirmations: recorded.confirmations });
    }

    if (payload.action === "fund") {
      if (deal.creatorWallet !== session.walletAddress || deal.status !== "terms_accepted") {
        throw new HttpError(409, "Only the creator can lock NIM after terms are accepted.", "conflict");
      }
      const check = await verifyOutgoing({
        hint: payload.transactionHint,
        expectedFrom: session.walletAddress,
        expectedValueLunas: deal.amountLunas,
      });
      if (check.status === "mismatch") throw new HttpError(400, check.reason ?? "That transaction does not match this deal.", "tx_mismatch");
      if (check.status !== "ok" || !check.tx) {
        throw new HttpError(409, check.reason ?? "The HTLC transaction is not confirmed yet. Retry in a few seconds.", "tx_unconfirmed");
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
          amountLunas: deal.amountLunas,
          note: deal.description,
          txHash: check.tx.hash,
          status: "confirmed",
          kind: "deal-fund",
          referenceId: deal.id,
          confirmations: check.tx.confirmations ?? 0,
        });
      }
      await db.insert(activity).values({
        id: crypto.randomUUID(),
        walletAddress: session.walletAddress,
        kind: "deal-fund",
        title: `Locked HTLC: ${deal.description}`,
        amountLunas: deal.amountLunas,
        status: "confirmed",
        referenceId: check.tx.hash,
      });
      await db.update(protectedDeals).set({
        status: "funded",
        htlcContractAddress: contract,
        hashRoot: payload.hashRoot ?? null,
        timeoutBlock: payload.timeoutBlock ?? null,
        escrowTransactionHash: check.tx.hash,
        updatedAt: new Date().toISOString(),
      }).where(eq(protectedDeals.id, deal.id));
      await persistLog("info", "deal_funded", { wallet: session.walletAddress, id: deal.id, txHash: check.tx.hash, contract });
      return jsonOk({ ok: true, status: "funded", txHash: check.tx.hash, contractAddress: contract });
    }

    if (payload.action === "release" || payload.action === "refund") {
      const contract = deal.htlcContractAddress;
      if (!contract || deal.status !== "funded" && deal.status !== "disputed" && deal.status !== "release_recommended" && deal.status !== "refund_recommended") {
        throw new HttpError(409, "There is no funded HTLC to settle.", "conflict");
      }
      const recipient = payload.action === "release" ? deal.counterpartyWallet : deal.creatorWallet;
      const recorded = await recordConfirmedPayment({
        senderWallet: contract,
        recipientWallet: recipient,
        amountLunas: deal.amountLunas,
        note: deal.description,
        kind: payload.action === "release" ? "deal-release" : "deal-refund",
        hint: payload.transactionHint,
        referenceId: deal.id,
        activityTitle: payload.action === "release" ? `Released deal: ${deal.description}` : `Refunded deal: ${deal.description}`,
      });
      const status = payload.action === "release" ? "released" : "refunded";
      await db.update(protectedDeals).set({ status, updatedAt: new Date().toISOString() }).where(eq(protectedDeals.id, deal.id));
      await persistLog("info", "deal_settled", { wallet: session.walletAddress, id: deal.id, status, txHash: recorded.txHash });
      return jsonOk({ ok: true, status, txHash: recorded.txHash });
    }

    if (payload.action === "open_dispute") {
      if (!isParty || !["terms_accepted", "funded"].includes(deal.status)) {
        throw new HttpError(409, "Only a party can open a dispute on an active deal.", "conflict");
      }
      await db.update(protectedDeals).set({ status: "disputed", updatedAt: new Date().toISOString() }).where(eq(protectedDeals.id, deal.id));
      await persistLog("info", "deal_disputed", { wallet: session.walletAddress, id: deal.id });
      return jsonOk({ ok: true, status: "disputed" });
    }

    if (payload.action === "add_evidence") {
      const body = payload.body?.trim().slice(0, 1_000) ?? "";
      if (!isParty || deal.status !== "disputed" || !body) {
        throw new HttpError(400, "A party can add a clear evidence note after a dispute is opened.", "bad_evidence");
      }
      const evidenceId = crypto.randomUUID();
      await db.insert(dealEvidence).values({ id: evidenceId, dealId: deal.id, authorWallet: session.walletAddress, body });
      return jsonOk({ evidence: { id: evidenceId, body } }, 201);
    }

    if (payload.action === "vote") {
      if (!myArbiter || deal.status !== "disputed" || !payload.vote) {
        throw new HttpError(400, "Only a selected arbiter can vote on an open dispute.", "forbidden");
      }
      await db.update(dealArbiters).set({ vote: payload.vote }).where(and(
        eq(dealArbiters.dealId, deal.id),
        eq(dealArbiters.walletAddress, session.walletAddress),
      ));
      const updated = await db.select().from(dealArbiters).where(eq(dealArbiters.dealId, deal.id));
      const releaseVotes = updated.filter((a) => a.vote === "release").length;
      const refundVotes = updated.filter((a) => a.vote === "refund").length;
      const majority = Math.floor(updated.length / 2) + 1;
      const recommendation = releaseVotes >= majority ? "release_recommended" : refundVotes >= majority ? "refund_recommended" : "awaiting_votes";
      if (recommendation !== "awaiting_votes") {
        await db.update(protectedDeals).set({ status: recommendation, updatedAt: new Date().toISOString() }).where(eq(protectedDeals.id, deal.id));
      }
      await persistLog("info", "deal_vote", { wallet: session.walletAddress, id: deal.id, vote: payload.vote, recommendation });
      return jsonOk({
        ok: true,
        votes: { release: releaseVotes, refund: refundVotes },
        recommendation,
        note: "Arbiter votes do not move NIM. The funded HTLC is released or refunded only by a wallet transaction.",
      });
    }

    throw new HttpError(400, "Choose a protected-deal action.", "unknown_action");
  } catch (error) {
    return jsonError(error);
  }
}
