import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import { conversations } from "../../../../db/schema";
import { requireUser } from "../../_lib/auth";
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
    const rows = await db.select().from(conversations).where(or(
      eq(conversations.walletA, session.walletAddress),
      eq(conversations.walletB, session.walletAddress),
    )).orderBy(desc(conversations.lastMessageAt));
    const handles = await handlesForWallets(rows.flatMap((row) => [row.walletA, row.walletB]));
    return jsonOk({
      conversations: rows.map((row) => {
        const peer = row.walletA === session.walletAddress ? row.walletB : row.walletA;
        return {
          id: row.id,
          peerWallet: peer,
          peerHandle: handles.get(peer) ?? null,
          lastMessageAt: row.lastMessageAt,
        };
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    await rateLimit(`chat-open:${session.walletAddress}`, 20);
    const payload = await readJson<{ handle?: string }>(request);
    const peer = await profileByHandle(payload.handle ?? "");
    const pair = conversationPair(session.walletAddress, peer.walletAddress);
    if (!pair) throw new HttpError(400, "You cannot start a chat with yourself.", "self_chat");
    const db = getDb();
    const [existing] = await db.select().from(conversations).where(and(
      eq(conversations.walletA, pair.a),
      eq(conversations.walletB, pair.b),
    )).limit(1);
    if (existing) return jsonOk({ conversation: { id: existing.id, peerHandle: peer.handle, peerWallet: peer.walletAddress } });
    const id = crypto.randomUUID();
    await db.insert(conversations).values({
      id,
      walletA: pair.a,
      walletB: pair.b,
      lastMessageAt: Date.now(),
    });
    await persistLog("info", "chat_started", { wallet: session.walletAddress, id, peer: peer.handle });
    return jsonOk({ conversation: { id, peerHandle: peer.handle, peerWallet: peer.walletAddress } }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
