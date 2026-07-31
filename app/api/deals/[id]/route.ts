import { and, eq, inArray } from "drizzle-orm";
import { requireSession } from "../../_lib/auth";
import { getDb } from "../../../../db";
import { activity, dealArbiters, dealEvidence, protectedDeals, profiles } from "../../../../db/schema";

type DealAction = "accept" | "open_dispute" | "vote" | "add_evidence";

function canSeeDeal(walletAddress: string, deal: typeof protectedDeals.$inferSelect, arbiterWallets: string[]) {
  return deal.creatorWallet === walletAddress || deal.counterpartyWallet === walletAddress || arbiterWallets.includes(walletAddress);
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const db = getDb();
  const [deal] = await db.select().from(protectedDeals).where(eq(protectedDeals.id, params.id)).limit(1);
  if (!deal) return Response.json({ error: "This protected deal was not found." }, { status: 404 });
  const arbiters = await db.select().from(dealArbiters).where(eq(dealArbiters.dealId, params.id));
  if (!canSeeDeal(session.walletAddress, deal, arbiters.map((arbiter) => arbiter.walletAddress))) {
    return Response.json({ error: "This protected deal is not assigned to your SayPay ID." }, { status: 403 });
  }
  const evidence = await db.select().from(dealEvidence).where(eq(dealEvidence.dealId, params.id));
  const walletIds = [...new Set([deal.creatorWallet, deal.counterpartyWallet, ...arbiters.map((arbiter) => arbiter.walletAddress), ...evidence.map((entry) => entry.authorWallet)])];
  const people = walletIds.length
    ? await db.select({ walletAddress: profiles.walletAddress, handle: profiles.handle }).from(profiles).where(inArray(profiles.walletAddress, walletIds))
    : [];
  const handles = new Map(people.map((person) => [person.walletAddress, person.handle]));
  return Response.json({
    deal: {
      ...deal,
      creatorHandle: handles.get(deal.creatorWallet) ?? "saypay-user",
      counterpartyHandle: handles.get(deal.counterpartyWallet) ?? "saypay-user",
    },
    arbiters: arbiters.map((arbiter) => ({ ...arbiter, handle: handles.get(arbiter.walletAddress) ?? "saypay-user" })),
    evidence: evidence.map((entry) => ({ ...entry, authorHandle: handles.get(entry.authorWallet) ?? "saypay-user" })),
  });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as { action?: DealAction; vote?: "release" | "refund"; body?: string };
  const db = getDb();
  const [deal] = await db.select().from(protectedDeals).where(eq(protectedDeals.id, params.id)).limit(1);
  if (!deal) return Response.json({ error: "This protected deal was not found." }, { status: 404 });
  const arbiters = await db.select().from(dealArbiters).where(eq(dealArbiters.dealId, params.id));
  const isParty = deal.creatorWallet === session.walletAddress || deal.counterpartyWallet === session.walletAddress;
  const myArbiter = arbiters.find((arbiter) => arbiter.walletAddress === session.walletAddress);
  if (!canSeeDeal(session.walletAddress, deal, arbiters.map((arbiter) => arbiter.walletAddress))) {
    return Response.json({ error: "This protected deal is not assigned to your SayPay ID." }, { status: 403 });
  }

  if (payload.action === "accept") {
    if (deal.counterpartyWallet !== session.walletAddress || deal.status !== "offered") {
      return Response.json({ error: "Only the invited counterparty can accept an offered deal." }, { status: 409 });
    }
    await db.update(protectedDeals).set({ status: "terms_accepted", updatedAt: new Date().toISOString() }).where(eq(protectedDeals.id, deal.id));
    await db.insert(activity).values({ id: crypto.randomUUID(), walletAddress: session.walletAddress, kind: "deal", title: `Accepted protected deal: ${deal.description}`, amountLunas: deal.amountLunas, currency: deal.currency, status: "terms_accepted", referenceId: deal.id });
    return Response.json({ ok: true, status: "terms_accepted", funding: "A deployed escrow contract is still required before funds can be locked." });
  }

  if (payload.action === "open_dispute") {
    if (!isParty || !["offered", "terms_accepted"].includes(deal.status)) {
      return Response.json({ error: "Only a party can open a dispute on an active deal." }, { status: 409 });
    }
    await db.update(protectedDeals).set({ status: "disputed", updatedAt: new Date().toISOString() }).where(eq(protectedDeals.id, deal.id));
    await db.insert(activity).values({ id: crypto.randomUUID(), walletAddress: session.walletAddress, kind: "deal", title: `Dispute opened: ${deal.description}`, amountLunas: deal.amountLunas, currency: deal.currency, status: "disputed", referenceId: deal.id });
    return Response.json({ ok: true, status: "disputed" });
  }

  if (payload.action === "add_evidence") {
    const body = payload.body?.trim().slice(0, 1_000) ?? "";
    if (!isParty || deal.status !== "disputed" || !body) {
      return Response.json({ error: "A party can add a clear evidence note after a dispute is opened." }, { status: 400 });
    }
    const id = crypto.randomUUID();
    await db.insert(dealEvidence).values({ id, dealId: deal.id, authorWallet: session.walletAddress, body });
    return Response.json({ evidence: { id, body } }, { status: 201 });
  }

  if (payload.action === "vote") {
    if (!myArbiter || deal.status !== "disputed" || !payload.vote) {
      return Response.json({ error: "Only a selected arbiter can vote on an open dispute." }, { status: 400 });
    }
    await db.update(dealArbiters).set({ vote: payload.vote }).where(and(eq(dealArbiters.dealId, deal.id), eq(dealArbiters.walletAddress, session.walletAddress)));
    const updated = await db.select().from(dealArbiters).where(eq(dealArbiters.dealId, deal.id));
    const releaseVotes = updated.filter((arbiter) => arbiter.vote === "release").length;
    const refundVotes = updated.filter((arbiter) => arbiter.vote === "refund").length;
    const majority = Math.floor(updated.length / 2) + 1;
    const recommendation = releaseVotes >= majority ? "release_recommended" : refundVotes >= majority ? "refund_recommended" : "awaiting_votes";
    if (recommendation !== "awaiting_votes") {
      await db.update(protectedDeals).set({ status: recommendation, updatedAt: new Date().toISOString() }).where(eq(protectedDeals.id, deal.id));
    }
    return Response.json({ ok: true, votes: { release: releaseVotes, refund: refundVotes }, recommendation, funding: "This is an arbiter recommendation. It cannot move funds until the escrow contract is deployed and wired." });
  }

  return Response.json({ error: "Choose a protected-deal action." }, { status: 400 });
}
