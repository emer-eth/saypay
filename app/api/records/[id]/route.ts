import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { agentRecords } from "../../../../db/schema";
import { requireUser } from "../../_lib/auth";
import { recordActivity } from "../../_lib/activity";
import { jsonError, jsonOk, readJson, HttpError } from "../../_lib/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const session = await requireUser(request);
    const { id } = await Promise.resolve(params);
    const db = getDb();
    const [row] = await db.select().from(agentRecords).where(and(
      eq(agentRecords.id, id),
      eq(agentRecords.walletAddress, session.walletAddress),
    )).limit(1);
    if (!row) throw new HttpError(404, "That record was not found.", "not_found");
    return jsonOk({
      record: {
        id: row.id,
        section: row.section,
        kind: row.kind,
        title: row.title,
        body: row.body,
        dueAt: row.dueAt,
        status: row.status,
        createdAt: row.createdAt,
        hasImage: Boolean(row.imageB64),
        image: row.imageB64 && row.imageMime ? `data:${row.imageMime};base64,${row.imageB64}` : null,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const session = await requireUser(request);
    const { id } = await Promise.resolve(params);
    const payload = await readJson<{ title?: string; body?: string; dueAt?: string | null; status?: string; kind?: string }>(request);
    const db = getDb();
    const [row] = await db.select().from(agentRecords).where(and(
      eq(agentRecords.id, id),
      eq(agentRecords.walletAddress, session.walletAddress),
    )).limit(1);
    if (!row) throw new HttpError(404, "That record was not found.", "not_found");
    const title = payload.title?.trim().slice(0, 80) ?? row.title;
    const body = payload.body?.trim().slice(0, 1_000) ?? row.body;
    const dueAt = payload.dueAt === undefined ? row.dueAt : (payload.dueAt?.trim() || null);
    const status = payload.status === "done" || payload.status === "open" ? payload.status : row.status;
    const kind = payload.kind?.trim() || row.kind;
    await db.update(agentRecords).set({
      title, body, dueAt, status, kind, updatedAt: new Date().toISOString(),
    }).where(eq(agentRecords.id, row.id));
    await recordActivity({
      wallet: session.walletAddress,
      kind,
      title: status === "done" && row.status !== "done" ? `Completed: ${title}` : `Updated ${kind}: ${title}`,
      status,
      referenceId: row.id,
    });
    return jsonOk({ ok: true, record: { id: row.id, title, body, dueAt, status, kind } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const session = await requireUser(request);
    const { id } = await Promise.resolve(params);
    const db = getDb();
    const [row] = await db.select().from(agentRecords).where(and(
      eq(agentRecords.id, id),
      eq(agentRecords.walletAddress, session.walletAddress),
    )).limit(1);
    if (!row) throw new HttpError(404, "That record was not found.", "not_found");
    await db.delete(agentRecords).where(eq(agentRecords.id, row.id));
    await recordActivity({
      wallet: session.walletAddress,
      kind: row.kind,
      title: `Removed ${row.kind}: ${row.title}`,
      status: "deleted",
      referenceId: row.id,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
