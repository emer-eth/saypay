import { eq } from "drizzle-orm";
import { requireSession } from "../../_lib/auth";
import { verifyBasicPayment } from "../../_lib/nimiq-rpc";
import { getDb } from "../../../../db";
import { activity, paymentRequests, profiles } from "../../../../db/schema";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const db = getDb();
  const [request] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, params.id)).limit(1);
  if (!request) return Response.json({ error: "This SayPay request was not found." }, { status: 404 });
  const [creator] = await db.select({ handle: profiles.handle }).from(profiles).where(eq(profiles.walletAddress, request.creatorWallet)).limit(1);
  return Response.json({ request: { ...request, creatorHandle: creator?.handle ?? "saypay-user" } });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });
  const payload = await request.json() as { transactionReference?: string };
  const hash = payload.transactionReference?.trim() ?? "";
  if (!hash) return Response.json({ error: "A Nimiq transaction hash is required." }, { status: 400 });

  const db = getDb();
  const [item] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, params.id)).limit(1);
  if (!item || item.recipientWallet !== session.walletAddress) return Response.json({ error: "This request is not assigned to your SayPay ID." }, { status: 403 });
  if (item.status !== "open") return Response.json({ error: "This request is already being processed." }, { status: 409 });

  const check = await verifyBasicPayment({
    transactionHash: hash,
    expectedRecipient: item.creatorWallet,
    expectedValueLunas: item.amountLunas,
  });
  if (check === "mismatch") {
    return Response.json({ error: "That transaction does not match this invoice amount or recipient." }, { status: 400 });
  }

  const status = check === "ok" ? "paid" : "submitted";
  await db.update(paymentRequests).set({ status, updatedAt: new Date().toISOString() }).where(eq(paymentRequests.id, item.id));
  const [creator] = await db.select({ handle: profiles.handle }).from(profiles).where(eq(profiles.walletAddress, item.creatorWallet)).limit(1);
  await db.insert(activity).values({
    id: crypto.randomUUID(),
    walletAddress: session.walletAddress,
    kind: "request-payment",
    title: `Paid request from @${creator?.handle ?? "SayPay user"}`,
    amountLunas: item.amountLunas,
    status,
    referenceId: hash.slice(0, 160),
  });
  return Response.json({ ok: true, status, verified: check === "ok" });
}
