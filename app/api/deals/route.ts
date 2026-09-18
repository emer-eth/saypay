import { desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { activity, dealArbiters, protectedDeals, profiles } from "../../../db/schema";
import { requireUser } from "../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../_lib/http";
import { persistLog } from "../_lib/log";
import { handleOf, requireLunas } from "../_lib/money";
import { profileByHandle, profilesByHandles } from "../_lib/people";

async function termsHash(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const direct = await db.select().from(protectedDeals).where(or(
      eq(protectedDeals.creatorWallet, session.walletAddress),
      eq(protectedDeals.counterpartyWallet, session.walletAddress),
    )).orderBy(desc(protectedDeals.createdAt));
    const arbitrationRows = await db.select().from(dealArbiters).where(eq(dealArbiters.walletAddress, session.walletAddress));
    const extraIds = arbitrationRows.map((row) => row.dealId);
    const extra = extraIds.length ? await db.select().from(protectedDeals).where(inArray(protectedDeals.id, extraIds)) : [];
    const all = [...new Map([...direct, ...extra].map((deal) => [deal.id, deal])).values()];
    const arbiters = all.length ? await db.select().from(dealArbiters).where(inArray(dealArbiters.dealId, all.map((deal) => deal.id))) : [];
    const wallets = [...new Set(all.flatMap((deal) => [deal.creatorWallet, deal.counterpartyWallet]))];
    const people = wallets.length
      ? await db.select({ walletAddress: profiles.walletAddress, handle: profiles.handle }).from(profiles).where(inArray(profiles.walletAddress, wallets))
      : [];
    const handles = new Map(people.map((person) => [person.walletAddress, person.handle]));
    return jsonOk({
      deals: all.map((deal) => ({
        ...deal,
        creatorHandle: handles.get(deal.creatorWallet) ?? null,
        counterpartyHandle: handles.get(deal.counterpartyWallet) ?? null,
      })),
      arbiters,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{
      counterpartyHandle?: string;
      arbiterHandles?: string[];
      amount?: number;
      description?: string;
      dueAt?: string;
    }>(request);
    const counterparty = await profileByHandle(payload.counterpartyHandle ?? "");
    const arbiterHandles = [...new Set((payload.arbiterHandles ?? []).map(handleOf).filter(Boolean))];
    if (![1, 3].includes(arbiterHandles.length)) {
      throw new HttpError(400, "Choose one or three trusted arbiters with SayPay IDs.", "arbiters");
    }
    if (arbiterHandles.includes(counterparty.handle)) {
      throw new HttpError(400, "The counterparty cannot also be an arbiter.", "arbiter_conflict");
    }
    const amountLunas = requireLunas(payload.amount);
    const description = payload.description?.trim().slice(0, 240) ?? "";
    if (!description) throw new HttpError(400, "Write the agreement in plain words.", "missing_terms");
    if (counterparty.walletAddress === session.walletAddress) {
      throw new HttpError(400, "Choose another SayPay user as the counterparty.", "self_deal");
    }
    const arbiters = await profilesByHandles(arbiterHandles);
    if (arbiters.some((person) => person.walletAddress === session.walletAddress)) {
      throw new HttpError(400, "The deal creator cannot also be an arbiter.", "self_arbiter");
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const hash = await termsHash(description);
    await db.insert(protectedDeals).values({
      id,
      creatorWallet: session.walletAddress,
      counterpartyWallet: counterparty.walletAddress,
      amountLunas,
      currency: "NIM",
      description,
      termsHash: hash,
      dueAt: payload.dueAt || null,
      status: "offered",
    });
    await db.insert(dealArbiters).values(arbiters.map((person) => ({
      id: crypto.randomUUID(),
      dealId: id,
      walletAddress: person.walletAddress,
    })));
    await db.insert(activity).values({
      id: crypto.randomUUID(),
      walletAddress: session.walletAddress,
      kind: "deal",
      title: `Protected deal: ${description}`,
      amountLunas,
      status: "offered",
      referenceId: id,
    });
    await persistLog("info", "deal_created", { wallet: session.walletAddress, id });
    return jsonOk({
      deal: {
        id,
        amountLunas,
        currency: "NIM",
        description,
        termsHash: hash,
        status: "offered",
        counterparty: counterparty.handle,
        arbiters: arbiters.map((person) => person.handle),
      },
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
