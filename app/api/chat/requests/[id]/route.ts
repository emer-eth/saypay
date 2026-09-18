import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { chatRequests, conversations } from "../../../../../db/schema";
import { requireUser } from "../../../_lib/auth";
import { recordActivity } from "../../../_lib/activity";
import { conversationPair } from "../../../_lib/escrow-resolve";
import { jsonError, jsonOk, readJson, HttpError } from "../../../_lib/http";
import { handlesForWallets } from "../../../_lib/invoices";
import { persistLog } from "../../../_lib/log";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const session = await requireUser(request);
    const { id } = await Promise.resolve(params);
    const payload = await readJson<{ action?: "accept" | "decline" }>(request);
    const db = getDb();
    const [row] = await db.select().from(chatRequests).where(eq(chatRequests.id, id)).limit(1);
    if (!row || row.toWallet !== session.walletAddress) throw new HttpError(404, "That chat request was not found.", "not_found");
    if (row.status !== "pending") throw new HttpError(409, "This request is no longer pending.", "conflict");

    if (payload.action === "decline") {
      await db.update(chatRequests).set({ status: "declined", updatedAt: new Date().toISOString() }).where(eq(chatRequests.id, row.id));
      await recordActivity({
        wallet: session.walletAddress,
        kind: "chat_request",
        title: "Declined a chat request",
        status: "declined",
        referenceId: row.id,
      });
      return jsonOk({ ok: true, status: "declined" });
    }

    if (payload.action !== "accept") throw new HttpError(400, "Choose accept or decline.", "unknown_action");
    const pair = conversationPair(row.fromWallet, row.toWallet);
    if (!pair) throw new HttpError(400, "Invalid chat pair.", "bad_pair");
    let [convo] = await db.select().from(conversations).where(and(
      eq(conversations.walletA, pair.a),
      eq(conversations.walletB, pair.b),
    )).limit(1);
    if (!convo) {
      const convoId = crypto.randomUUID();
      await db.insert(conversations).values({
        id: convoId,
        walletA: pair.a,
        walletB: pair.b,
        lastMessageAt: Date.now(),
      });
      [convo] = await db.select().from(conversations).where(eq(conversations.id, convoId)).limit(1);
    }
    await db.update(chatRequests).set({
      status: "accepted",
      conversationId: convo!.id,
      updatedAt: new Date().toISOString(),
    }).where(eq(chatRequests.id, row.id));
    const handles = await handlesForWallets([row.fromWallet, row.toWallet]);
    const peerWallet = row.fromWallet;
    await recordActivity({
      wallet: session.walletAddress,
      kind: "chat_request",
      title: `Accepted chat with @${handles.get(peerWallet) ?? "user"}`,
      status: "accepted",
      referenceId: row.id,
    });
    await persistLog("info", "chat_request_accepted", { wallet: session.walletAddress, id: row.id });
    return jsonOk({
      ok: true,
      status: "accepted",
      conversation: {
        id: convo!.id,
        peerWallet,
        peerHandle: handles.get(peerWallet) ?? null,
      },
      draft: row.draft,
    });
  } catch (error) {
    return jsonError(error);
  }
}
