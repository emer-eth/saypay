export function nextInvoiceNumber(existing: Array<string | null | undefined>, year = new Date().getUTCFullYear()) {
  const prefix = `SAY-${year}-`;
  let max = 0;
  for (const value of existing) {
    if (!value?.startsWith(prefix)) continue;
    const seq = Number(value.slice(prefix.length));
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export function localDayKey(value: string | Date) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export type InvoiceBucket = "overdue" | "due_today" | "open" | "other";

export function invoiceBucket(dueAt: string | null | undefined, status: string, now = new Date()): InvoiceBucket {
  if (status !== "open") return "other";
  if (!dueAt) return "open";
  const due = localDayKey(dueAt);
  const today = localDayKey(now);
  if (!due || !today) return "open";
  if (due < today) return "overdue";
  if (due === today) return "due_today";
  return "open";
}

export function quantityMilli(quantity: number) {
  const milli = Math.round(Number(quantity) * 1000);
  if (!Number.isFinite(milli) || milli < 1) return 0;
  return milli;
}

export function lineAmountLunas(quantity: number, unitLunas: number) {
  const milli = quantityMilli(quantity);
  if (!milli || !Number.isInteger(unitLunas) || unitLunas < 1) return 0;
  return Math.round((milli * unitLunas) / 1000);
}

export function presentQuantity(milli: number) {
  return milli / 1000;
}

export function timerBill(durationMs: number, rateLunasPerHour: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  if (!Number.isInteger(rateLunasPerHour) || rateLunasPerHour < 1) return null;
  const hours = durationMs / 3_600_000;
  const amountLunas = Math.round(hours * rateLunasPerHour);
  if (amountLunas < 1) return null;
  return { hours, amountLunas };
}

export function formatHours(ms: number) {
  const hours = Math.max(0, ms) / 3_600_000;
  const digits = hours >= 10 ? 1 : 2;
  return hours.toFixed(digits);
}
