// Local design preview. Only on a local dev host with ?preview in the URL (see isLocalDevHost):
// fills every tab with obviously fictional sample data so the signed-in screens can be designed
// and screenshotted without a wallet. It never runs on the deployed Worker and never touches money.
import type { AgentRecord, InvoiceRow, WorkLedger } from "../work-panel";
import type { JobRow } from "../work-jobs";
import type { EscrowRow } from "../work-escrow";
import { isLocalDevHost } from "./host";

const NIM = 100_000;
const now = Date.now();
const day = 86_400_000;
const iso = (offsetDays: number) => new Date(now + offsetDays * day).toISOString();

export function previewEnabled() {
  if (typeof window === "undefined" || !isLocalDevHost()) return false;
  return new URLSearchParams(window.location.search).has("preview");
}

const ME = "NQ00 PREV IEW0 0000 0000 0000 0000 0000 0001";
const MAYA = "NQ00 PREV IEW0 0000 0000 0000 0000 0000 0002";
const LEO = "NQ00 PREV IEW0 0000 0000 0000 0000 0000 0003";

function invoice(partial: Partial<InvoiceRow> & Pick<InvoiceRow, "id" | "amountLunas" | "note" | "status">): InvoiceRow {
  return {
    kind: "invoice", invoiceNumber: null, dueAt: null, creatorWallet: ME, recipientWallet: MAYA,
    creatorHandle: "emer", recipientHandle: "maya", paidTransactionHash: null, lineItems: [], ...partial,
  };
}

const overdue = invoice({ id: "i1", invoiceNumber: "SAY-2026-014", amountLunas: 420 * NIM, note: "Brand refresh, round 2", status: "open", dueAt: iso(-3), recipientHandle: "studio-kite", recipientWallet: LEO });
const dueToday = invoice({ id: "i2", invoiceNumber: "SAY-2026-015", amountLunas: 180 * NIM, note: "Landing page", status: "open", dueAt: iso(0) });
const upcoming = invoice({ id: "i3", invoiceNumber: "SAY-2026-016", amountLunas: 95 * NIM, note: "Copy edits", status: "open", dueAt: iso(5) });
const paid = invoice({ id: "i4", invoiceNumber: "SAY-2026-013", amountLunas: 260 * NIM, note: "Icon set", status: "paid", dueAt: iso(-9), paidTransactionHash: "preview0000000000000000000000000000000000000000000000000000000000" });
const iOwe = invoice({ id: "i5", invoiceNumber: "SAY-2026-031", amountLunas: 60 * NIM, note: "Shared Figma seat", status: "open", dueAt: iso(2), creatorHandle: "leo", creatorWallet: LEO, recipientHandle: "emer", recipientWallet: ME });

export const previewData = {
  session: { token: "preview", address: ME, handle: "emer" },
  balance: { nim: 1284.5, usd: 2.31, lunas: 1284.5 * NIM },
  contacts: [
    { walletAddress: MAYA, nickname: "Maya", handle: "maya", verifiedAt: iso(-30) },
    { walletAddress: LEO, nickname: "Leo", handle: "leo", verifiedAt: null },
  ],
  activity: [
    { id: "a1", kind: "invoice_paid", title: "Icon set · paid by @maya", amountLunas: 260 * NIM, status: "paid", createdAt: iso(-1) },
    { id: "a2", kind: "send", title: "Split dinner with @leo", amountLunas: 24 * NIM, status: "confirmed", createdAt: iso(-2) },
    { id: "a3", kind: "invoice", title: "Landing page · invoice sent", amountLunas: 180 * NIM, status: "open", createdAt: iso(-4) },
    { id: "a4", kind: "invoice_paid", title: "Logo sketches · paid by @kite", amountLunas: 150 * NIM, status: "paid", createdAt: iso(-8) },
  ],
  schedules: [
    { id: "s1", amountLunas: 40 * NIM, note: "Studio rent share", runAt: now + 4 * day, status: "scheduled", recipientHandle: "leo", recipientWallet: LEO, recurrence: "weekly" },
  ],
  work: {
    owedLunas: (420 + 180 + 95) * NIM,
    oweLunas: 60 * NIM,
    dueTodayLunas: 180 * NIM,
    overdueLunas: 420 * NIM,
    dueToday: [dueToday],
    overdue: [overdue],
    receivable: [overdue, dueToday, upcoming, paid],
    payable: [iOwe],
    splitsOwed: [],
    timer: { id: "t1", clientHandle: "maya", clientWallet: MAYA, description: "Landing page QA", rateLunasPerHour: 45 * NIM, startedAt: now - 47 * 60_000, endedAt: null, durationMs: null, status: "running", invoiceId: null },
    unbilled: [
      { id: "t0", clientHandle: "maya", clientWallet: MAYA, description: "Wireframes", rateLunasPerHour: 45 * NIM, startedAt: now - 2 * day, endedAt: now - 2 * day + 2.5 * 3_600_000, durationMs: 2.5 * 3_600_000, status: "stopped", invoiceId: null },
    ],
  } satisfies WorkLedger,
  escrows: [] as EscrowRow[],
  jobs: [
    {
      id: "j1", title: "Kite studio website", status: "active", iAm: "worker", workerWallet: ME, clientWallet: LEO, workerHandle: "emer", clientHandle: "studio-kite",
      stages: [
        { id: "st1", title: "Design", amountLunas: 300 * NIM, dueAt: iso(-10), status: "paid", invoiceId: "i0", invoiceNumber: "SAY-2026-011", escrowId: null, escrowStatus: null },
        { id: "st2", title: "Build", amountLunas: 420 * NIM, dueAt: iso(-3), status: "invoiced", invoiceId: "i1", invoiceNumber: "SAY-2026-014", escrowId: null, escrowStatus: null },
        { id: "st3", title: "Launch support", amountLunas: 120 * NIM, dueAt: iso(12), status: "open", invoiceId: null, invoiceNumber: null, escrowId: null, escrowStatus: null },
      ],
    },
  ] satisfies JobRow[],
  records: [
    { id: "r1", section: "tasks", kind: "task", title: "Send Maya the QA notes", body: "Before Friday's call.", dueAt: iso(1), status: "open", hasImage: false, createdAt: iso(-1) },
    { id: "r2", section: "receipts", kind: "receipt", title: "Figma subscription", body: "15 USD · design tools", dueAt: null, status: "filed", hasImage: false, createdAt: iso(-6) },
    { id: "r3", section: "reminders", kind: "reminder", title: "Chase Kite for the build invoice", body: "", dueAt: iso(0), status: "open", hasImage: false, createdAt: iso(-3) },
  ] satisfies AgentRecord[],
  messages: [
    { id: "m1", kind: "user", text: "Invoice @maya 180 NIM for the landing page, due Friday" },
    {
      id: "m2", kind: "plan", text: "Invoice @maya 180 NIM for the landing page, due Friday",
      summary: "Invoice 180 NIM to @maya for landing page, due Friday.",
      who: { label: "@maya", handle: "maya", address: MAYA },
      intent: { kind: "invoice", asset: "NIM", amount: 180, recipientHint: "@maya", participants: [], note: "Landing page", remindAt: null, recurrence: "once", timerAction: null, confidence: "high", question: null },
    },
  ] as const,
};
