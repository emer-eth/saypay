import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatRequests, conversations } from "../../../../db/schema";
import { requireUser } from "../../_lib/auth";
import { recordActivity } from "../../_lib/activity";
import { conversationPair } from "../../_lib/escrow-resolve";
import { jsonError, jsonOk, readJson, HttpError } from "../../_lib/http";
import { handlesForWallets } from "../../_lib/invoices";
import { persistLog } from "../../_lib/log";
import { profileByHandle } from "../../_lib/people";
import { rateLimit } from "../../_lib/rate-limit";

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const rows = await db.select().from(chatRequests).where(or(
      eq(chatRequests.fromWallet, session.walletAddress),
      eq(chatRequests.toWallet, session.walletAddress),
    )).orderBy(desc(chatRequests.createdAt));
    const handles = await handlesForWallets(rows.flatMap((row) => [row.fromWallet, row.toWallet]));
    const incoming = rows.filter((row) => row.toWallet === session.walletAddress && row.status === "pending");
    const outgoing = rows.filter((row) => row.fromWallet === session.walletAddress && row.status === "pending");
    const present = (row: typeof rows[number], peer: string) => ({
      id: row.id,
      peerHandle: handles.get(peer) ?? null,
      peerWallet: peer,
      draft: row.draft,
      status: row.status,
      createdAt: row.createdAt,
    });
    return jsonOk({
      incoming: incoming.map((row) => present(row, row.fromWallet)),
      outgoing: outgoing.map((row) => present(row, row.toWallet)),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    await rateLimit(`chat-request:${session.walletAddress}`, 20);
    const payload = await readJson<{ handle?: string; draft?: string }>(request);
    const peer = await profileByHandle(payload.handle ?? "");
    const pair = conversationPair(session.walletAddress, peer.walletAddress);
    if (!pair) throw new HttpError(400, "You cannot chat with yourself.", "self_chat");
    const db = getDb();
    const [existingConvo] = await db.select().from(conversations).where(and(
      eq(conversations.walletA, pair.a),
      eq(conversations.walletB, pair.b),
    )).limit(1);
    if (existingConvo) {
      return jsonOk({
        already: true,
        conversation: { id: existingConvo.id, peerHandle: peer.handle, peerWallet: peer.walletAddress },
      });
    }
    const [pending] = await db.select().from(chatRequests).where(and(
      eq(chatRequests.fromWallet, session.walletAddress),
      eq(chatRequests.toWallet, peer.walletAddress),
      eq(chatRequests.status, "pending"),
    )).limit(1);
    if (pending) return jsonOk({ request: { id: pending.id, peerHandle: peer.handle, status: "pending" } });
    const id = crypto.randomUUID();
    const draft = payload.draft?.trim().slice(0, 500) ?? "";
    await db.insert(chatRequests).values({
      id,
      fromWallet: session.walletAddress,
      toWallet: peer.walletAddress,
      draft,
      status: "pending",
    });
    await recordActivity({
      wallet: session.walletAddress,
      kind: "chat_request",
      title: `Chat request sent to @${peer.handle}`,
      status: "pending",
      referenceId: id,
    });
    await persistLog("info", "chat_request_sent", { wallet: session.walletAddress, id, peer: peer.handle });
    return jsonOk({ request: { id, peerHandle: peer.handle, status: "pending" } }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
