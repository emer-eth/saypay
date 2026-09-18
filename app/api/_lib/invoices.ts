import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { activity, invoiceLineItems, paymentRequests, profiles } from "../../../db/schema";
import { HttpError } from "./http";
import { persistLog } from "./log";
import { requireLunas } from "./money";
import { profileByHandle } from "./people";
import { lineAmountLunas, nextInvoiceNumber, quantityMilli } from "./work";

export type LineInput = { description?: string; quantity?: number; unitNim?: number };

export type CreatedInvoice = {
  id: string;
  invoiceNumber: string | null;
  kind: "invoice" | "request";
  amountLunas: number;
  note: string;
  dueAt: string | null;
  recipient: string;
  lineItems: Array<{ description: string; quantity: number; unitLunas: number; amountLunas: number }>;
};

export function parseDueAt(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new HttpError(400, "Due date must be a real date.", "bad_due");
  const date = new Date(parsed);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function createInvoice(options: {
  creatorWallet: string;
  recipientHandle: string;
  note?: string;
  dueAt?: string | null;
  kind?: "invoice" | "request";
  lineItems?: LineInput[];
  amountNim?: number;
  amountLunas?: number;
  jobId?: string | null;
}): Promise<CreatedInvoice> {
  const recipient = await profileByHandle(options.recipientHandle);
  if (recipient.walletAddress === options.creatorWallet) {
    throw new HttpError(400, "You cannot invoice yourself.", "self_request");
  }

  const kind = options.kind === "request" ? "request" : "invoice";
  const lines = buildLines(options);
  const amountLunas = lines.reduce((sum, line) => sum + line.amountLunas, 0);
  const note = (options.note?.trim() || lines[0]?.description || "").slice(0, 120);
  if (!note) throw new HttpError(400, "Add a note so the payer knows what this is for.", "missing_note");
  const dueAt = parseDueAt(options.dueAt);

  const db = getDb();
  const existing = kind === "invoice"
    ? await db.select({ invoiceNumber: paymentRequests.invoiceNumber }).from(paymentRequests).where(eq(paymentRequests.creatorWallet, options.creatorWallet))
    : [];
  const invoiceNumber = kind === "invoice" ? nextInvoiceNumber(existing.map((row) => row.invoiceNumber)) : null;
  const id = crypto.randomUUID();

  await db.insert(paymentRequests).values({
    id,
    creatorWallet: options.creatorWallet,
    recipientWallet: recipient.walletAddress,
    kind,
    amountLunas,
    note,
    dueAt,
    invoiceNumber,
    jobId: options.jobId ?? null,
  });
  if (lines.length) {
    await db.insert(invoiceLineItems).values(lines.map((line, index) => ({
      id: crypto.randomUUID(),
      requestId: id,
      description: line.description,
      quantityMilli: line.quantityMilli,
      unitLunas: line.unitLunas,
      amountLunas: line.amountLunas,
      sortOrder: index,
    })));
  }
  await db.insert(activity).values({
    id: crypto.randomUUID(),
    walletAddress: options.creatorWallet,
    kind,
    title: kind === "invoice"
      ? `${invoiceNumber} · @${recipient.handle}`
      : `Request for @${recipient.handle}`,
    amountLunas,
    status: "open",
    referenceId: id,
  });
  await persistLog("info", "request_created", { wallet: options.creatorWallet, id, kind, invoiceNumber });

  return {
    id,
    invoiceNumber,
    kind,
    amountLunas,
    note,
    dueAt,
    recipient: recipient.handle,
    lineItems: lines.map((line) => ({
      description: line.description,
      quantity: line.quantityMilli / 1000,
      unitLunas: line.unitLunas,
      amountLunas: line.amountLunas,
    })),
  };
}

export type StoredRequest = typeof paymentRequests.$inferSelect;
export type StoredLine = typeof invoiceLineItems.$inferSelect;

export function presentLines(rows: StoredLine[], fallback: { note: string; amountLunas: number }) {
  if (!rows.length) {
    return [{
      description: fallback.note,
      quantity: 1,
      unitLunas: fallback.amountLunas,
      amountLunas: fallback.amountLunas,
    }];
  }
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((row) => ({
    id: row.id,
    description: row.description,
    quantity: row.quantityMilli / 1000,
    unitLunas: row.unitLunas,
    amountLunas: row.amountLunas,
  }));
}

export async function linesForRequests(ids: string[]) {
  if (!ids.length) return new Map<string, StoredLine[]>();
  const db = getDb();
  const rows = await db.select().from(invoiceLineItems).where(inArray(invoiceLineItems.requestId, ids));
  const map = new Map<string, StoredLine[]>();
  for (const row of rows) {
    const list = map.get(row.requestId) ?? [];
    list.push(row);
    map.set(row.requestId, list);
  }
  return map;
}

export async function handlesForWallets(wallets: Array<string | null | undefined>) {
  const ids = [...new Set(wallets.filter((value): value is string => Boolean(value)))];
  if (!ids.length) return new Map<string, string>();
  const db = getDb();
  const people = await db.select({ walletAddress: profiles.walletAddress, handle: profiles.handle }).from(profiles).where(inArray(profiles.walletAddress, ids));
  return new Map(people.map((person) => [person.walletAddress, person.handle]));
}

export function presentRequest(
  item: StoredRequest,
  lines: StoredLine[],
  handles: Map<string, string>,
) {
  return {
    id: item.id,
    kind: item.kind,
    invoiceNumber: item.invoiceNumber,
    amountLunas: item.amountLunas,
    currency: item.currency,
    note: item.note,
    dueAt: item.dueAt,
    status: item.status,
    creatorWallet: item.creatorWallet,
    recipientWallet: item.recipientWallet,
    creatorHandle: handles.get(item.creatorWallet) ?? "saypay-user",
    recipientHandle: item.recipientWallet ? handles.get(item.recipientWallet) ?? null : null,
    paidTransactionHash: item.paidTransactionHash,
    jobId: item.jobId,
    createdAt: item.createdAt,
    lineItems: presentLines(lines, { note: item.note, amountLunas: item.amountLunas }),
  };
}

function buildLines(options: {
  note?: string;
  lineItems?: LineInput[];
  amountNim?: number;
  amountLunas?: number;
}) {
  if (options.lineItems?.length) {
    return options.lineItems.map((item) => {
      const description = item.description?.trim().slice(0, 120) ?? "";
      if (!description) throw new HttpError(400, "Every line needs a description.", "missing_line");
      const unitLunas = requireLunas(item.unitNim, "Every line needs a NIM rate greater than zero.");
      const milli = quantityMilli(Number(item.quantity ?? 1));
      if (!milli) throw new HttpError(400, "Quantity must be greater than zero.", "invalid_qty");
      const amountLunas = lineAmountLunas(milli / 1000, unitLunas);
      if (amountLunas < 1) throw new HttpError(400, "A line item rounded to zero NIM.", "line_too_small");
      return { description, quantityMilli: milli, unitLunas, amountLunas };
    });
  }

  const amountLunas = options.amountLunas && options.amountLunas > 0
    ? Math.round(options.amountLunas)
    : requireLunas(options.amountNim);
  const description = options.note?.trim().slice(0, 120) || "Invoice";
  return [{ description, quantityMilli: 1000, unitLunas: amountLunas, amountLunas }];
}
