import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { chatMessages, conversations } from "../../../../../db/schema";
import { requireUser } from "../../../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../../../_lib/http";
import { persistLog } from "../../../_lib/log";
import { rateLimit } from "../../../_lib/rate-limit";

function member(wallet: string, row: typeof conversations.$inferSelect) {
  return row.walletA === wallet || row.walletB === wallet;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const session = await requireUser(request);
    const { id } = await Promise.resolve(params);
    const db = getDb();
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    if (!row || !member(session.walletAddress, row)) throw new HttpError(404, "Conversation not found.", "not_found");
    const url = new URL(request.url);
    const after = Number(url.searchParams.get("after") ?? "0");
    const messages = await db.select().from(chatMessages).where(
      after > 0
        ? and(eq(chatMessages.conversationId, id))
        : eq(chatMessages.conversationId, id),
    );
    const filtered = messages.filter((item) => item.createdAt > after).sort((a, b) => a.createdAt - b.createdAt).slice(-100);
    return jsonOk({
      conversation: { id: row.id, walletA: row.walletA, walletB: row.walletB },
      messages: filtered.map((item) => ({
        id: item.id,
        senderWallet: item.senderWallet,
        ciphertext: item.ciphertext,
        iv: item.iv,
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const session = await requireUser(request);
    await rateLimit(`chat-send:${session.walletAddress}`, 60);
    const { id } = await Promise.resolve(params);
    const payload = await readJson<{ ciphertext?: string; iv?: string }>(request);
    const ciphertext = payload.ciphertext?.trim() ?? "";
    const iv = payload.iv?.trim() ?? "";
    if (!ciphertext || !iv) throw new HttpError(400, "Encrypted message is required.", "missing_message");
    if (ciphertext.length > 8_192) throw new HttpError(400, "Message is too large.", "too_large");
    const db = getDb();
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    if (!row || !member(session.walletAddress, row)) throw new HttpError(404, "Conversation not found.", "not_found");
    const createdAt = Date.now();
    const messageId = crypto.randomUUID();
    await db.insert(chatMessages).values({
      id: messageId,
      conversationId: row.id,
      senderWallet: session.walletAddress,
      ciphertext,
      iv,
      createdAt,
    });
    await db.update(conversations).set({ lastMessageAt: createdAt }).where(eq(conversations.id, row.id));
    await persistLog("info", "chat_message", { wallet: session.walletAddress, id: row.id });
    return jsonOk({ message: { id: messageId, senderWallet: session.walletAddress, ciphertext, iv, createdAt } }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
