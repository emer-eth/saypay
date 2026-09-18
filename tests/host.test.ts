import assert from "node:assert/strict";
import test from "node:test";
import { detectPlatform, isLocalDevHost, nimiqPayLinks, saypayHost } from "../app/lib/host";
import { conversationPair, resolveEscrowVotes } from "../app/api/_lib/escrow-resolve";

test("iPhone UA is ios, Pixel is android, desktop is other", () => {
  assert.equal(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "ios");
  assert.equal(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), "android");
  assert.equal(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "other");
});

test("local and LAN hosts are treated as dev", () => {
  assert.equal(isLocalDevHost("localhost"), true);
  assert.equal(isLocalDevHost("192.168.1.20"), true);
  assert.equal(isLocalDevHost("saypay-payment-assistant.emerxch.workers.dev"), false);
});

test("store and open links point at official Nimiq Pay", () => {
  const links = nimiqPayLinks("https://saypay-payment-assistant.emerxch.workers.dev");
  assert.match(links.ios, /id6471844738/);
  assert.match(links.android, /com\.nimiq\.pay/);
  assert.equal(links.openHttps, "https://nimpay.app/miniapps/open/saypay-payment-assistant.emerxch.workers.dev");
  assert.equal(saypayHost("https://saypay-payment-assistant.emerxch.workers.dev/"), "saypay-payment-assistant.emerxch.workers.dev");
});

test("escrow humans agreeing skips AI", () => {
  const r = resolveEscrowVotes({ creatorEscrowVote: "release", counterpartyEscrowVote: "release", aiVote: null });
  assert.equal(r.status, "release_recommended");
  assert.equal(r.winner, "humans");
});

test("escrow disagreement waits for AI then uses it", () => {
  const wait = resolveEscrowVotes({ creatorEscrowVote: "release", counterpartyEscrowVote: "refund", aiVote: null });
  assert.equal(wait.status, "needs_ai");
  const settled = resolveEscrowVotes({ creatorEscrowVote: "release", counterpartyEscrowVote: "refund", aiVote: "refund" });
  assert.equal(settled.status, "refund_recommended");
  assert.equal(settled.winner, "ai");
});

test("conversation pair is ordered and rejects self-chat", () => {
  const pair = conversationPair("NQ07 AAA", "nq07 bbb");
  assert.ok(pair);
  assert.equal(pair.a < pair.b, true);
  assert.equal(conversationPair("NQ07 AAA", "nq07 aaa"), null);
});
