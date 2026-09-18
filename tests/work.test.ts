import assert from "node:assert/strict";
import test from "node:test";
import { formatHours, invoiceBucket, lineAmountLunas, nextInvoiceNumber, quantityMilli, timerBill } from "../app/api/_lib/work";
import { parseLocalIntent } from "../app/api/_lib/local-intent";
import { isActionable } from "../app/api/_lib/intent-schema";

test("invoice numbers increment per year", () => {
  assert.equal(nextInvoiceNumber([], 2026), "SAY-2026-001");
  assert.equal(nextInvoiceNumber(["SAY-2026-001", "SAY-2026-009", "SAY-2025-040"], 2026), "SAY-2026-010");
});

test("line items round through milli-quantities", () => {
  assert.equal(quantityMilli(2.4), 2400);
  assert.equal(lineAmountLunas(2.4, 4_000_000), 9_600_000);
  assert.equal(lineAmountLunas(1, 5_000_000), 5_000_000);
  assert.equal(lineAmountLunas(0, 5_000_000), 0);
});

test("timer bill uses duration × hourly rate", () => {
  const twoHours = 2 * 3_600_000;
  const bill = timerBill(twoHours, 4_000_000);
  assert.ok(bill);
  assert.equal(bill.amountLunas, 8_000_000);
  assert.equal(formatHours(twoHours), "2.00");
});

test("overdue vs due today vs open", () => {
  const now = new Date("2026-09-11T15:00:00");
  assert.equal(invoiceBucket("2026-09-10", "open", now), "overdue");
  assert.equal(invoiceBucket("2026-09-11", "open", now), "due_today");
  assert.equal(invoiceBucket("2026-09-18", "open", now), "open");
  assert.equal(invoiceBucket("2026-09-10", "paid", now), "other");
  assert.equal(invoiceBucket(null, "open", now), "open");
});

test("what's overdue is a ledger query", () => {
  const intent = parseLocalIntent("What's overdue?");
  assert.equal(intent.kind, "ledger");
  assert.equal(intent.confidence, "high");
  assert.equal(isActionable(intent), true);
});

test("start timer needs a client and a rate", () => {
  const missing = parseLocalIntent("Start timer for @maya");
  assert.equal(missing.kind, "timer");
  assert.equal(missing.timerAction, "start");
  assert.equal(missing.confidence, "needs_clarification");

  const ok = parseLocalIntent("Start timer for @maya at 40 NIM an hour");
  assert.equal(ok.kind, "timer");
  assert.equal(ok.timerAction, "start");
  assert.equal(ok.amount, 40);
  assert.match(ok.recipientHint ?? "", /maya/i);
  assert.equal(isActionable(ok), true);
});

test("stop and bill timer do not need an amount", () => {
  const stop = parseLocalIntent("Stop the timer");
  assert.equal(stop.kind, "timer");
  assert.equal(stop.timerAction, "stop");
  assert.equal(isActionable(stop), true);

  const bill = parseLocalIntent("Bill my timer");
  assert.equal(bill.kind, "timer");
  assert.equal(bill.timerAction, "bill");
  assert.equal(isActionable(bill), true);
});

test("bill hours at a rate becomes an invoice", () => {
  const intent = parseLocalIntent("Bill 2.4 hours at 40 NIM/h to @maya for landing page");
  assert.equal(intent.kind, "invoice");
  assert.equal(intent.amount, 96);
  assert.match(intent.recipientHint ?? "", /maya/i);
  assert.equal(intent.confidence, "high");
});
