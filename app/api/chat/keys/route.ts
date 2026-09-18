import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatKeys } from "../../../../db/schema";
import { requireUser } from "../../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../../_lib/http";
import { profileByHandle } from "../../_lib/people";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const handle = url.searchParams.get("handle");
    if (handle) {
      const profile = await profileByHandle(handle);
      const db = getDb();
      const [row] = await db.select().from(chatKeys).where(eq(chatKeys.walletAddress, profile.walletAddress)).limit(1);
      if (!row) throw new HttpError(404, `@${profile.handle} has not opened Chat yet.`, "no_chat_key");
      return jsonOk({ handle: profile.handle, walletAddress: profile.walletAddress, publicJwk: row.publicJwk });
    }
    const session = await requireUser(request);
    const db = getDb();
    const [row] = await db.select().from(chatKeys).where(eq(chatKeys.walletAddress, session.walletAddress)).limit(1);
    if (!row) return jsonOk({ key: null });
    return jsonOk({
      key: {
        publicJwk: row.publicJwk,
        wrappedPrivate: row.wrappedPrivate,
        wrapIv: row.wrapIv,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{ publicJwk?: string; wrappedPrivate?: string; wrapIv?: string }>(request);
    if (!payload.publicJwk || !payload.wrappedPrivate || !payload.wrapIv) {
      throw new HttpError(400, "A public key and wrapped private key are required.", "missing_key");
    }
    if (payload.publicJwk.length > 2_000 || payload.wrappedPrivate.length > 8_000) {
      throw new HttpError(400, "Chat key payload is too large.", "too_large");
    }
    try { JSON.parse(payload.publicJwk); } catch { throw new HttpError(400, "Public key must be JSON.", "bad_key"); }
    const db = getDb();
    const now = new Date().toISOString();
    const [existing] = await db.select().from(chatKeys).where(eq(chatKeys.walletAddress, session.walletAddress)).limit(1);
    if (existing) {
      await db.update(chatKeys).set({
        publicJwk: payload.publicJwk,
        wrappedPrivate: payload.wrappedPrivate,
        wrapIv: payload.wrapIv,
        updatedAt: now,
      }).where(eq(chatKeys.walletAddress, session.walletAddress));
    } else {
      await db.insert(chatKeys).values({
        walletAddress: session.walletAddress,
        publicJwk: payload.publicJwk,
        wrappedPrivate: payload.wrappedPrivate,
        wrapIv: payload.wrapIv,
      });
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
