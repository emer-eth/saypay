import { desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { activity, paymentRequests, workEscrows, workJobStages, workJobs } from "../../../db/schema";
import { requireUser } from "../_lib/auth";
import { jsonError, jsonOk, readJson, HttpError } from "../_lib/http";
import { handlesForWallets, parseDueAt } from "../_lib/invoices";
import { jobIsComplete, stageDisplayStatus } from "../_lib/jobs";
import { persistLog } from "../_lib/log";
import { requireLunas } from "../_lib/money";
import { profileByHandle } from "../_lib/people";

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const db = getDb();
    const jobs = await db.select().from(workJobs).where(or(
      eq(workJobs.workerWallet, session.walletAddress),
      eq(workJobs.clientWallet, session.walletAddress),
    )).orderBy(desc(workJobs.createdAt));
    const jobIds = jobs.map((job) => job.id);
    const stages = jobIds.length ? await db.select().from(workJobStages).where(inArray(workJobStages.jobId, jobIds)) : [];
    const invoiceIds = stages.map((stage) => stage.invoiceId).filter((id): id is string => Boolean(id));
    const escrowIds = stages.map((stage) => stage.escrowId).filter((id): id is string => Boolean(id));
    const invoices = invoiceIds.length ? await db.select().from(paymentRequests).where(inArray(paymentRequests.id, invoiceIds)) : [];
    const escrows = escrowIds.length ? await db.select().from(workEscrows).where(inArray(workEscrows.id, escrowIds)) : [];
    const invoiceMap = new Map(invoices.map((row) => [row.id, row]));
    const escrowMap = new Map(escrows.map((row) => [row.id, row]));
    const handles = await handlesForWallets(jobs.flatMap((job) => [job.workerWallet, job.clientWallet]));

    const presented = jobs.map((job) => {
      const jobStages = stages.filter((stage) => stage.jobId === job.id).sort((a, b) => a.sortOrder - b.sortOrder);
      const presentedStages = jobStages.map((stage) => {
        const invoice = stage.invoiceId ? invoiceMap.get(stage.invoiceId) : undefined;
        const escrow = stage.escrowId ? escrowMap.get(stage.escrowId) : undefined;
        const displayStatus = stageDisplayStatus({
          status: stage.status,
          invoiceStatus: invoice?.status ?? null,
          escrowStatus: escrow?.status ?? null,
        });
        return {
          id: stage.id,
          title: stage.title,
          amountLunas: stage.amountLunas,
          dueAt: stage.dueAt,
          status: displayStatus,
          invoiceId: stage.invoiceId,
          invoiceNumber: invoice?.invoiceNumber ?? null,
          escrowId: stage.escrowId,
          escrowStatus: escrow?.status ?? null,
        };
      });
      const complete = jobIsComplete(presentedStages.map((stage) => stage.status));
      return {
        id: job.id,
        title: job.title,
        status: complete ? "completed" : job.status,
        iAm: job.workerWallet === session.walletAddress ? "worker" : "client",
        workerWallet: job.workerWallet,
        clientWallet: job.clientWallet,
        workerHandle: handles.get(job.workerWallet) ?? null,
        clientHandle: handles.get(job.clientWallet) ?? null,
        stages: presentedStages,
      };
    });

    return jsonOk({ jobs: presented });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await readJson<{
      title?: string;
      otherHandle?: string;
      iAm?: "worker" | "client";
      stages?: Array<{ title?: string; amount?: number; dueAt?: string }>;
    }>(request);
    const title = payload.title?.trim().slice(0, 80) ?? "";
    if (title.length < 2) throw new HttpError(400, "Give this job a name.", "missing_title");
    const other = await profileByHandle(payload.otherHandle ?? "");
    if (other.walletAddress === session.walletAddress) {
      throw new HttpError(400, "A job needs another SayPay ID.", "self_job");
    }
    const iAm = payload.iAm === "client" ? "client" : "worker";
    const workerWallet = iAm === "worker" ? session.walletAddress : other.walletAddress;
    const clientWallet = iAm === "client" ? session.walletAddress : other.walletAddress;
    const stages = (payload.stages ?? [])
      .map((stage) => ({
        title: stage.title?.trim().slice(0, 80) ?? "",
        amount: stage.amount,
        dueAt: stage.dueAt,
      }))
      .filter((stage) => stage.title);
    if (!stages.length) throw new HttpError(400, "Add at least one stage with a name and NIM amount.", "missing_stages");
    if (stages.length > 8) throw new HttpError(400, "Keep it to eight stages.", "too_many_stages");

    const db = getDb();
    const id = crypto.randomUUID();
    await db.insert(workJobs).values({
      id,
      workerWallet,
      clientWallet,
      title,
      createdBy: iAm,
      status: "open",
    });
    await db.insert(workJobStages).values(stages.map((stage, index) => ({
      id: crypto.randomUUID(),
      jobId: id,
      title: stage.title,
      amountLunas: requireLunas(stage.amount, `Stage “${stage.title}” needs a NIM amount.`),
      dueAt: parseDueAt(stage.dueAt),
      sortOrder: index,
      status: "pending",
    })));
    await db.insert(activity).values({
      id: crypto.randomUUID(),
      walletAddress: session.walletAddress,
      kind: "job",
      title: `Job: ${title}`,
      amountLunas: stages.reduce((sum, stage) => sum + requireLunas(stage.amount), 0),
      status: "open",
      referenceId: id,
    });
    await persistLog("info", "job_created", { wallet: session.walletAddress, id, stages: stages.length });
    return jsonOk({ job: { id, title, iAm, other: other.handle, stages: stages.length } }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
