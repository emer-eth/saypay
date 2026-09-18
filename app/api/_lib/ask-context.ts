import { and, desc, eq, inArray, or } from "drizzle-orm";
import { formatNim } from "../../_lib/units";
import { getDb } from "../../../db";
import {
  agentRecords,
  contacts,
  paymentRequests,
  profiles,
  scheduledPayments,
  timeEntries,
  workJobStages,
  workJobs,
} from "../../../db/schema";
import { invoiceBucket } from "./work";

export async function askAppSnapshot(wallet: string) {
  const db = getDb();
  const [profile] = await db.select({ handle: profiles.handle, language: profiles.language }).from(profiles).where(eq(profiles.walletAddress, wallet)).limit(1);
  const people = await db.select({ nickname: contacts.nickname }).from(contacts).where(eq(contacts.ownerWallet, wallet));
  const invoices = await db.select().from(paymentRequests).where(or(
    eq(paymentRequests.creatorWallet, wallet),
    eq(paymentRequests.recipientWallet, wallet),
  )).orderBy(desc(paymentRequests.createdAt));
  const openMine = invoices.filter((row) => row.creatorWallet === wallet && row.status === "open");
  const openTheirs = invoices.filter((row) => row.recipientWallet === wallet && row.status === "open");
  const overdue = openMine.filter((row) => invoiceBucket(row.dueAt, row.status) === "overdue");
  const [timer] = await db.select().from(timeEntries).where(and(eq(timeEntries.walletAddress, wallet), eq(timeEntries.status, "running"))).limit(1);
  const jobs = await db.select().from(workJobs).where(or(eq(workJobs.workerWallet, wallet), eq(workJobs.clientWallet, wallet))).orderBy(desc(workJobs.createdAt));
  const jobIds = jobs.map((job) => job.id);
  const stages = jobIds.length
    ? await db.select().from(workJobStages).where(inArray(workJobStages.jobId, jobIds))
    : [];
  const schedules = await db.select().from(scheduledPayments).where(eq(scheduledPayments.creatorWallet, wallet)).orderBy(desc(scheduledPayments.createdAt));
  const records = await db.select({
    kind: agentRecords.kind,
    title: agentRecords.title,
    section: agentRecords.section,
  }).from(agentRecords).where(eq(agentRecords.walletAddress, wallet)).orderBy(desc(agentRecords.createdAt));

  const lines = [
    `SayPay ID: @${profile?.handle ?? "unknown"}`,
    `Language: ${profile?.language ?? "en"}`,
    `Open invoices you issued: ${openMine.length} totaling ${formatNim(openMine.reduce((s, r) => s + r.amountLunas, 0))} NIM`,
    `Open invoices you owe: ${openTheirs.length} totaling ${formatNim(openTheirs.reduce((s, r) => s + r.amountLunas, 0))} NIM`,
    `Overdue: ${overdue.length}${overdue[0] ? ` (e.g. ${overdue[0].note || overdue[0].invoiceNumber})` : ""}`,
    timer ? `Timer running for @${timer.clientHandle} at ${formatNim(timer.rateLunasPerHour)} NIM/h` : "No timer running",
    `Open jobs: ${jobs.filter((j) => j.status === "open").length}${jobs[0] ? ` (latest: ${jobs[0].title}, ${stages.length} stages on latest)` : ""}`,
    `Scheduled sends: ${schedules.length}`,
    people.length ? `Saved people: ${people.map((p) => p.nickname).join(", ")}` : "No saved people",
    records.length
      ? `Ask filings: ${records.slice(0, 8).map((r) => `${r.kind}:${r.title}→${r.section}`).join("; ")}`
      : "No Ask filings yet",
  ];
  return { handle: profile?.handle ?? null, language: profile?.language ?? "en", text: lines.join("\n") };
}
