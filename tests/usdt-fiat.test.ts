import assert from "node:assert/strict";
import test from "node:test";
import { parsePriceCurrency, quoteFiat } from "../app/api/_lib/prices";
import { verifyUsdtTransfer, USDT_POLYGON } from "../app/api/_lib/polygon";

const realFetch = globalThis.fetch;
function mockFetch(handler: (url: string, body: { method?: string } | null) => unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as { method?: string } : null;
    return new Response(JSON.stringify(handler(url, body)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
test.afterEach(() => { globalThis.fetch = realFetch; });

test("price currency is NIM, USD or EUR only", () => {
  assert.equal(parsePriceCurrency(null), null);
  assert.equal(parsePriceCurrency("NIM"), null);
  assert.equal(parsePriceCurrency("eur"), "EUR");
  assert.throws(() => parsePriceCurrency("GBP"), /NIM, USD or EUR/);
});

test("a fiat price converts to NIM and USDT, rounded up so the payee is never short", async () => {
  mockFetch(() => ({ "nimiq-2": { usd: 0.0018 }, tether: { usd: 0.9995 } }));
  const quote = await quoteFiat("USD", 15000); // $150.00
  assert.equal(quote.lunas, Math.ceil((150 / 0.0018) * 100_000));
  assert.ok(quote.lunas / 100_000 >= 150 / 0.0018);
  // 150 / 0.9995 = 150.075… → rounded up to whole cents of USDT: 150.08
  assert.equal(quote.usdtMicro, 150_080_000);
});

const PAYEE = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topic = (addr: string) => `0x${addr.slice(2).toLowerCase().padStart(64, "0")}`;

function polygon(receipt: unknown, head = "0x64") {
  mockFetch((_url, body) => (body?.method === "eth_getTransactionReceipt" ? { result: receipt } : { result: head }));
}
const receipt = (to: string, micro: number, status = "0x1") => ({
  status,
  blockNumber: "0x5a",
  from: "0x2222222222222222222222222222222222222222",
  to: USDT_POLYGON,
  logs: [{ address: USDT_POLYGON, topics: [TRANSFER, topic("0x2222222222222222222222222222222222222222"), topic(to)], data: `0x${micro.toString(16).padStart(64, "0")}` }],
});

test("USDT counts only when it reached the payee, in full, and has settled", async () => {
  polygon(receipt(PAYEE, 25_000_000));
  const ok = await verifyUsdtTransfer({ txHash: HASH, payee: PAYEE, minMicro: 25_000_000 });
  assert.equal(ok.status, "ok");

  polygon(receipt(PAYEE, 24_990_000));
  const short = await verifyUsdtTransfer({ txHash: HASH, payee: PAYEE, minMicro: 25_000_000 });
  assert.equal(short.status, "mismatch");

  polygon(receipt("0x3333333333333333333333333333333333333333", 25_000_000));
  const elsewhere = await verifyUsdtTransfer({ txHash: HASH, payee: PAYEE, minMicro: 25_000_000 });
  assert.equal(elsewhere.status, "mismatch");

  polygon(receipt(PAYEE, 25_000_000, "0x0"));
  const failed = await verifyUsdtTransfer({ txHash: HASH, payee: PAYEE, minMicro: 25_000_000 });
  assert.equal(failed.status, "mismatch");

  polygon(null);
  const missing = await verifyUsdtTransfer({ txHash: HASH, payee: PAYEE, minMicro: 25_000_000 });
  assert.equal(missing.status, "pending");

  polygon(receipt(PAYEE, 25_000_000), "0x5a"); // same block as the receipt: 1 confirmation
  const fresh = await verifyUsdtTransfer({ txHash: HASH, payee: PAYEE, minMicro: 25_000_000 });
  assert.equal(fresh.status, "pending");
});

test("a malformed hash is refused without calling Polygon", async () => {
  let called = false;
  mockFetch(() => { called = true; return {}; });
  const bad = await verifyUsdtTransfer({ txHash: "0x123", payee: PAYEE, minMicro: 1 });
  assert.equal(bad.status, "mismatch");
  assert.equal(called, false);
});
