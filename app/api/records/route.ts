import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { agentRecords } from "../../../db/schema";
import { requireUser } from "../_lib/auth";
import { jsonError, jsonOk } from "../_lib/http";

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const rows = await db.select({
      id: agentRecords.id,
      section: agentRecords.section,
      kind: agentRecords.kind,
      title: agentRecords.title,
      body: agentRecords.body,
      dueAt: agentRecords.dueAt,
      status: agentRecords.status,
      imageMime: agentRecords.imageMime,
      sourceUtterance: agentRecords.sourceUtterance,
      createdAt: agentRecords.createdAt,
    }).from(agentRecords)
      .where(eq(agentRecords.walletAddress, session.walletAddress))
      .orderBy(desc(agentRecords.createdAt));
    return jsonOk({
      records: rows.map((row) => ({
        id: row.id,
        section: row.section,
        kind: row.kind,
        title: row.title,
        body: row.body,
        dueAt: row.dueAt,
        status: row.status,
        sourceUtterance: row.sourceUtterance,
        createdAt: row.createdAt,
        hasImage: Boolean(row.imageMime),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
