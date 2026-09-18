import assert from "node:assert/strict";
import test from "node:test";

const BASE = process.env.SAYPAY_URL ?? "https://saypay-payment-assistant.emerxch.workers.dev";

test("live worker health and auth gates", { skip: process.env.SAYPAY_LIVE !== "1" }, async () => {
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.ok, true);
  const body = await health.json() as { ok: boolean; rpc: { ok: boolean } };
  assert.equal(body.ok, true);
  assert.equal(body.rpc.ok, true);

  const intent = await fetch(`${BASE}/api/intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Send 1 NIM" }),
  });
  assert.equal(intent.status, 401);

  const due = await fetch(`${BASE}/api/schedules/due`, { method: "POST", headers: { "x-saypay-cron": "1" } });
  assert.notEqual(due.status, 200);
});
