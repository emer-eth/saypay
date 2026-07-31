import { desc, eq, or } from "drizzle-orm";
import { requireSession } from "../_lib/auth";
import { getDb } from "../../../db";
import { activity, paymentRequests, profiles } from "../../../db/schema";

function toLunas(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100_000) : 0;
}

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const db = getDb();
  const requests = await db.select().from(paymentRequests).where(or(eq(paymentRequests.creatorWallet, session.walletAddress), eq(paymentRequests.recipientWallet, session.walletAddress))).orderBy(desc(paymentRequests.createdAt));
  return Response.json({ requests });
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as { recipientHandle?: string; amount?: number; note?: string; dueAt?: string; kind?: "request" | "invoice" };
  const recipientHandle = payload.recipientHandle?.replace(/^@/, "").trim().toLowerCase() ?? "";
  const amountLunas = toLunas(payload.amount);
  const note = payload.note?.trim().slice(0, 120) ?? "";
  if (!recipientHandle || !amountLunas || !note) return Response.json({ error: "Recipient, amount, and note are required." }, { status: 400 });
  const db = getDb();
  const [recipient] = await db.select().from(profiles).where(eq(profiles.handle, recipientHandle)).limit(1);
  if (!recipient) return Response.json({ error: `@${recipientHandle} has not claimed a SayPay ID.` }, { status: 404 });
  const id = crypto.randomUUID();
  const kind = payload.kind === "invoice" ? "invoice" : "request";
  await db.insert(paymentRequests).values({ id, creatorWallet: session.walletAddress, recipientWallet: recipient.walletAddress, kind, amountLunas, note, dueAt: payload.dueAt || null });
  await db.insert(activity).values({ id: crypto.randomUUID(), walletAddress: session.walletAddress, kind, title: `${kind === "invoice" ? "Invoice" : "Request"} for @${recipientHandle}`, amountLunas, status: "open", referenceId: id });
  return Response.json({ request: { id, recipient: recipient.handle, amountLunas, note, kind } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as { id?: string; status?: "declined" | "cancelled" };
  if (!payload.id || !payload.status) return Response.json({ error: "A request and status are required." }, { status: 400 });
  const db = getDb();
  const [item] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, payload.id)).limit(1);
  if (!item || (item.creatorWallet !== session.walletAddress && item.recipientWallet !== session.walletAddress)) return Response.json({ error: "Request not found." }, { status: 404 });
  await db.update(paymentRequests).set({ status: payload.status, updatedAt: new Date().toISOString() }).where(eq(paymentRequests.id, item.id));
  return Response.json({ ok: true });
}
