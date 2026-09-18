import { desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { activity, profiles, workEscrowEvidence, workEscrowVotes, workEscrows } from "../../../db/schema";
import { requireUser } from "../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../_lib/http";
import { persistLog } from "../_lib/log";
import { requireLunas } from "../_lib/money";
import { profileByHandle } from "../_lib/people";
import { handlesForWallets } from "../_lib/invoices";

async function termsHash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function involved(wallet: string, row: typeof workEscrows.$inferSelect) {
  return [
    row.creatorWallet,
    row.counterpartyWallet,
    row.creatorEscrowWallet,
    row.counterpartyEscrowWallet,
  ].includes(wallet);
}

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const rows = await db.select().from(workEscrows).where(or(
      eq(workEscrows.creatorWallet, session.walletAddress),
      eq(workEscrows.counterpartyWallet, session.walletAddress),
      eq(workEscrows.creatorEscrowWallet, session.walletAddress),
      eq(workEscrows.counterpartyEscrowWallet, session.walletAddress),
    )).orderBy(desc(workEscrows.createdAt));
    const mine = rows.filter((row) => involved(session.walletAddress, row));
    const ids = mine.map((row) => row.id);
    const votes = ids.length ? await db.select().from(workEscrowVotes).where(inArray(workEscrowVotes.escrowId, ids)) : [];
    const evidence = ids.length ? await db.select().from(workEscrowEvidence).where(inArray(workEscrowEvidence.escrowId, ids)) : [];
    const handles = await handlesForWallets(mine.flatMap((row) => [
      row.creatorWallet, row.counterpartyWallet, row.creatorEscrowWallet, row.counterpartyEscrowWallet,
    ]));
    return jsonOk({
      escrows: mine.map((row) => ({
        ...row,
        creatorHandle: handles.get(row.creatorWallet) ?? null,
        counterpartyHandle: handles.get(row.counterpartyWallet) ?? null,
        creatorEscrowHandle: handles.get(row.creatorEscrowWallet) ?? null,
        counterpartyEscrowHandle: row.counterpartyEscrowWallet ? handles.get(row.counterpartyEscrowWallet) ?? null : null,
        votes: votes.filter((vote) => vote.escrowId === row.id),
        evidence: evidence.filter((item) => item.escrowId === row.id),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{
      counterpartyHandle?: string;
      escrowHandle?: string;
      amount?: number;
      description?: string;
    }>(request);
    const counterparty = await profileByHandle(payload.counterpartyHandle ?? "");
    const escrow = await profileByHandle(payload.escrowHandle ?? "");
    if (counterparty.walletAddress === session.walletAddress) {
      throw new HttpError(400, "Choose another SayPay user as the other party.", "self_escrow");
    }
    if (escrow.walletAddress === session.walletAddress || escrow.walletAddress === counterparty.walletAddress) {
      throw new HttpError(400, "Your escrow must be a third SayPay ID — not you or the other party.", "escrow_party");
    }
    const amountLunas = requireLunas(payload.amount);
    const description = payload.description?.trim().slice(0, 240) ?? "";
    if (!description) throw new HttpError(400, "Write what this escrow covers in plain words.", "missing_terms");
    const db = getDb();
    const id = crypto.randomUUID();
    const hash = await termsHash(description);
    await db.insert(workEscrows).values({
      id,
      creatorWallet: session.walletAddress,
      counterpartyWallet: counterparty.walletAddress,
      creatorEscrowWallet: escrow.walletAddress,
      amountLunas,
      description,
      termsHash: hash,
      status: "offered",
    });
    await db.insert(activity).values({
      id: crypto.randomUUID(),
      walletAddress: session.walletAddress,
      kind: "escrow",
      title: `Escrow offered: ${description}`,
      amountLunas,
      status: "offered",
      referenceId: id,
    });
    await persistLog("info", "escrow_created", { wallet: session.walletAddress, id });
    const [me] = await db.select({ handle: profiles.handle }).from(profiles).where(eq(profiles.walletAddress, session.walletAddress)).limit(1);
    return jsonOk({
      escrow: {
        id,
        amountLunas,
        description,
        status: "offered",
        counterparty: counterparty.handle,
        creatorEscrow: escrow.handle,
        creator: me?.handle ?? null,
      },
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

