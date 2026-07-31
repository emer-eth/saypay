import { desc, eq, inArray, or } from "drizzle-orm";
import { requireSession } from "../_lib/auth";
import { getDb } from "../../../db";
import { activity, dealArbiters, protectedDeals, profiles } from "../../../db/schema";

function toLunas(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100_000) : 0;
}

function handle(value: string) {
  return value.replace(/^@/, "").trim().toLowerCase();
}

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Link your Nimiq Pay account first." }, { status: 401 });
  const db = getDb();
  const directDeals = await db.select().from(protectedDeals).where(or(eq(protectedDeals.creatorWallet, session.walletAddress), eq(protectedDeals.counterpartyWallet, session.walletAddress))).orderBy(desc(protectedDeals.createdAt));
  const arbitrationRows = await db.select().from(dealArbiters).where(eq(dealArbiters.walletAddress, session.walletAddress));
  const arbitrationIds = arbitrationRows.map((row) => row.dealId);
  const arbitrationDeals = arbitrationIds.length ? await db.select().from(protectedDeals).where(inArray(protectedDeals.id, arbitrationIds)) : [];
  const all = [...new Map([...directDeals, ...arbitrationDeals].map((deal) => [deal.id, deal])).values()];
  const arbiters = all.length ? await db.select().from(dealArbiters).where(inArray(dealArbiters.dealId, all.map((deal) => deal.id))) : [];
  return Response.json({ deals: all, arbiters });
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Link your Nimiq Pay account first." }, { status: 401 });
  const payload = await request.json() as { counterpartyHandle?: string; arbiterHandles?: string[]; amount?: number; currency?: "NIM" | "USDT"; description?: string; dueAt?: string };
  const counterpartyHandle = handle(payload.counterpartyHandle ?? "");
  const arbiterHandles = [...new Set((payload.arbiterHandles ?? []).map(handle).filter(Boolean))];
  const amountLunas = toLunas(payload.amount);
  const description = payload.description?.trim().slice(0, 240) ?? "";
  const currency = payload.currency === "NIM" ? "NIM" : "USDT";
  if (!counterpartyHandle || !amountLunas || !description) return Response.json({ error: "Counterparty, amount, and clear terms are required." }, { status: 400 });
  if (![1, 3].includes(arbiterHandles.length)) return Response.json({ error: "Choose one or three trusted arbiters." }, { status: 400 });
  if (arbiterHandles.includes(counterpartyHandle)) return Response.json({ error: "The counterparty cannot also be an arbiter." }, { status: 400 });
  const db = getDb();
  const handles = [counterpartyHandle, ...arbiterHandles];
  const people = await db.select().from(profiles).where(inArray(profiles.handle, handles));
  if (people.length !== handles.length) return Response.json({ error: "Counterparty and arbiters each need a SayPay ID." }, { status: 404 });
  const counterparty = people.find((person) => person.handle === counterpartyHandle);
  if (!counterparty || counterparty.walletAddress === session.walletAddress) return Response.json({ error: "Choose another SayPay user as the counterparty." }, { status: 400 });
  const arbiters = arbiterHandles.map((value) => people.find((person) => person.handle === value)).filter((person): person is NonNullable<typeof person> => Boolean(person));
  if (arbiters.some((person) => person.walletAddress === session.walletAddress)) return Response.json({ error: "The deal creator cannot also be an arbiter." }, { status: 400 });
  const id = crypto.randomUUID();
  await db.insert(protectedDeals).values({ id, creatorWallet: session.walletAddress, counterpartyWallet: counterparty.walletAddress, amountLunas, currency, description, dueAt: payload.dueAt || null, status: "offered" });
  await db.insert(dealArbiters).values(arbiters.map((person) => ({ id: crypto.randomUUID(), dealId: id, walletAddress: person.walletAddress })));
  await db.insert(activity).values({ id: crypto.randomUUID(), walletAddress: session.walletAddress, kind: "deal", title: `Protected deal: ${description}`, amountLunas, currency, status: "offered", referenceId: id });
  return Response.json({ deal: { id, amountLunas, currency, description, status: "offered", counterparty: counterparty.handle, arbiters: arbiters.map((person) => person.handle), funded: false } }, { status: 201 });
}
