import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { activity, profiles, splitGroups, splitParticipants } from "../../../db/schema";
import { requireUser } from "../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../_lib/http";
import { persistLog } from "../_lib/log";
import { handleOf, requireLunas } from "../_lib/money";
import { profilesByHandles } from "../_lib/people";

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const invited = await db.select({ participant: splitParticipants, split: splitGroups })
      .from(splitParticipants)
      .innerJoin(splitGroups, eq(splitParticipants.splitId, splitGroups.id))
      .where(eq(splitParticipants.participantWallet, session.walletAddress))
      .orderBy(desc(splitGroups.createdAt));
    const created = await db.select().from(splitGroups).where(eq(splitGroups.creatorWallet, session.walletAddress)).orderBy(desc(splitGroups.createdAt));
    return jsonOk({ invited, created });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{ participantHandles?: string[]; amount?: number; note?: string }>(request);
    const handles = [...new Set((payload.participantHandles ?? []).map(handleOf).filter(Boolean))];
    if (!handles.length) throw new HttpError(400, "Every split participant needs a claimed SayPay @handle.", "missing_participants");
    const amountLunas = requireLunas(payload.amount);
    const note = payload.note?.trim().slice(0, 120) ?? "";
    if (!note) throw new HttpError(400, "Add a note for this split.", "missing_note");
    const members = await profilesByHandles(handles);
    if (members.some((member) => member.walletAddress === session.walletAddress)) {
      throw new HttpError(400, "Leave yourself out of the participant list — you are the creator.", "self_split");
    }
    const totalPeople = members.length + 1;
    const shareLunas = Math.floor(amountLunas / totalPeople);
    const creatorShareLunas = amountLunas - (shareLunas * members.length);
    if (shareLunas <= 0) throw new HttpError(400, "The split amount is too small for this number of people.", "share_too_small");

    const db = getDb();
    const id = crypto.randomUUID();
    await db.insert(splitGroups).values({ id, creatorWallet: session.walletAddress, amountLunas, note });
    await db.insert(splitParticipants).values(members.map((member) => ({
      id: crypto.randomUUID(),
      splitId: id,
      participantWallet: member.walletAddress,
      shareLunas,
    })));
    await db.insert(activity).values({
      id: crypto.randomUUID(),
      walletAddress: session.walletAddress,
      kind: "split",
      title: `Split: ${note}`,
      amountLunas,
      status: "open",
      referenceId: id,
    });
    await persistLog("info", "split_created", { wallet: session.walletAddress, id });
    const people = await db.select({ walletAddress: profiles.walletAddress, handle: profiles.handle }).from(profiles).where(inArray(profiles.walletAddress, members.map((m) => m.walletAddress)));
    return jsonOk({
      split: {
        id,
        amountLunas,
        shareLunas,
        creatorShareLunas,
        participants: people.map((person) => person.handle),
      },
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
