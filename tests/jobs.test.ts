import assert from "node:assert/strict";
import test from "node:test";
import { jobIsComplete, stageDisplayStatus } from "../app/api/_lib/jobs";

test("a stage with a paid invoice is paid", () => {
  assert.equal(stageDisplayStatus({ status: "invoiced", invoiceStatus: "paid" }), "paid");
});

test("a stage with a released escrow is paid", () => {
  assert.equal(stageDisplayStatus({ status: "escrowed", escrowStatus: "released" }), "paid");
});

test("invoice is the default path", () => {
  assert.equal(stageDisplayStatus({ status: "pending" }), "pending");
  assert.equal(stageDisplayStatus({ status: "invoiced", invoiceStatus: "open" }), "invoiced");
});

test("job completes when every stage is paid or cancelled and at least one is paid", () => {
  assert.equal(jobIsComplete(["paid", "paid"]), true);
  assert.equal(jobIsComplete(["paid", "cancelled"]), true);
  assert.equal(jobIsComplete(["cancelled", "cancelled"]), false);
  assert.equal(jobIsComplete(["paid", "pending"]), false);
});
