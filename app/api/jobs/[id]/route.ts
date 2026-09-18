import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { activity, profiles, workEscrows, workJobStages, workJobs } from "../../../../db/schema";
import { requireUser } from "../../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../../_lib/http";
import { createInvoice, parseDueAt } from "../../_lib/invoices";
import { persistLog } from "../../_lib/log";
import { requireLunas } from "../../_lib/money";
import { profileByHandle } from "../../_lib/people";

async function termsHash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const session = await requireUser(request);
    const { id } = await Promise.resolve(params);
    const payload = await readJson<{
      action?: "invoice_stage" | "request_escrow" | "start_escrow" | "add_stage" | "cancel";
      stageId?: string;
      escrowHandle?: string;
      title?: string;
      amount?: number;
      dueAt?: string;
    }>(request);
    const db = getDb();
    const [job] = await db.select().from(workJobs).where(eq(workJobs.id, id)).limit(1);
    if (!job) throw new HttpError(404, "This job was not found.", "not_found");
    const isWorker = job.workerWallet === session.walletAddress;
    const isClient = job.clientWallet === session.walletAddress;
    if (!isWorker && !isClient) throw new HttpError(403, "This job is not yours.", "forbidden");

    if (payload.action === "cancel") {
      if (job.status !== "open") throw new HttpError(409, "This job is no longer open.", "conflict");
      await db.update(workJobs).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(eq(workJobs.id, job.id));
      return jsonOk({ ok: true, status: "cancelled" });
    }

    if (payload.action === "add_stage") {
      if (job.status !== "open") throw new HttpError(409, "This job is no longer open.", "conflict");
      const title = payload.title?.trim().slice(0, 80) ?? "";
      if (!title) throw new HttpError(400, "Name the stage.", "missing_title");
      const existing = await db.select().from(workJobStages).where(eq(workJobStages.jobId, job.id));
      if (existing.length >= 8) throw new HttpError(400, "Keep it to eight stages.", "too_many_stages");
      const stageId = crypto.randomUUID();
      await db.insert(workJobStages).values({
        id: stageId,
        jobId: job.id,
        title,
        amountLunas: requireLunas(payload.amount),
        dueAt: parseDueAt(payload.dueAt),
        sortOrder: existing.length,
        status: "pending",
      });
      return jsonOk({ ok: true, stageId }, 201);
    }

    const [stage] = payload.stageId
      ? await db.select().from(workJobStages).where(eq(workJobStages.id, payload.stageId)).limit(1)
      : [];
    if (!stage || stage.jobId !== job.id) throw new HttpError(404, "That stage was not found.", "not_found");

    if (payload.action === "invoice_stage") {
      if (!isWorker) throw new HttpError(403, "Only the worker invoices a stage.", "forbidden");
      if (!["pending", "escrow_requested"].includes(stage.status)) {
        throw new HttpError(409, "This stage is already in motion.", "conflict");
      }
      const [client] = await db.select({ handle: profiles.handle }).from(profiles).where(eq(profiles.walletAddress, job.clientWallet)).limit(1);
      if (!client) throw new HttpError(404, "The client no longer has a SayPay ID.", "not_found");
      const clientHandle = client.handle;
      const invoice = await createInvoice({
        creatorWallet: session.walletAddress,
        recipientHandle: clientHandle,
        note: `${job.title} — ${stage.title}`,
        dueAt: stage.dueAt,
        amountLunas: stage.amountLunas,
        jobId: job.id,
      });
      await db.update(workJobStages).set({
        status: "invoiced",
        invoiceId: invoice.id,
        updatedAt: new Date().toISOString(),
      }).where(eq(workJobStages.id, stage.id));
      await persistLog("info", "job_stage_invoiced", { wallet: session.walletAddress, jobId: job.id, stageId: stage.id, invoiceId: invoice.id });
      return jsonOk({ ok: true, status: "invoiced", invoice });
    }

    if (payload.action === "request_escrow") {
      if (!isWorker) throw new HttpError(403, "Only the worker can ask the client to escrow a stage.", "forbidden");
      if (stage.status !== "pending") throw new HttpError(409, "Escrow can be requested on a pending stage.", "conflict");
      await db.update(workJobStages).set({ status: "escrow_requested", updatedAt: new Date().toISOString() }).where(eq(workJobStages.id, stage.id));
      return jsonOk({ ok: true, status: "escrow_requested" });
    }

    if (payload.action === "start_escrow") {
      if (!isClient) throw new HttpError(403, "Only the client starts escrow on a stage.", "forbidden");
      if (!["pending", "escrow_requested"].includes(stage.status)) {
        throw new HttpError(409, "This stage cannot be escrowed now.", "conflict");
      }
      const escrow = await profileByHandle(payload.escrowHandle ?? "");
      if ([job.clientWallet, job.workerWallet].includes(escrow.walletAddress)) {
        throw new HttpError(400, "Your escrow must be a third SayPay ID.", "escrow_party");
      }
      const escrowId = crypto.randomUUID();
      const description = `${job.title} — ${stage.title}`;
      await db.insert(workEscrows).values({
        id: escrowId,
        creatorWallet: job.clientWallet,
        counterpartyWallet: job.workerWallet,
        creatorEscrowWallet: escrow.walletAddress,
        amountLunas: stage.amountLunas,
        description,
        termsHash: await termsHash(description),
        status: "offered",
      });
      await db.insert(activity).values({
        id: crypto.randomUUID(),
        walletAddress: session.walletAddress,
        kind: "escrow",
        title: `Escrow offered: ${description}`,
        amountLunas: stage.amountLunas,
        status: "offered",
        referenceId: escrowId,
      });
      await db.update(workJobStages).set({
        status: "escrowed",
        escrowId,
        updatedAt: new Date().toISOString(),
      }).where(eq(workJobStages.id, stage.id));
      await persistLog("info", "job_stage_escrowed", { wallet: session.walletAddress, jobId: job.id, stageId: stage.id, escrowId });
      return jsonOk({ ok: true, status: "escrowed", escrowId });
    }

    throw new HttpError(400, "Choose a job action.", "unknown_action");
  } catch (error) {
    return jsonError(error);
  }
}
