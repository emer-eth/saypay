#!/usr/bin/env node
// End-to-end check of the SayPay ID claim: challenge, sign, verify, session.
//
// Generates a throwaway Nimiq key pair and signs the challenge exactly the way
// the route reconstructs it, so a regression in the signed-message framing or
// in the verification call shows up here rather than on a phone.
//
//   node scripts/verify-signature-flow.mjs [baseUrl]

import { BufferUtils, Hash, KeyPair, Signature } from "@nimiq/core";

const BASE = process.argv[2] ?? "http://localhost:3000";
const handle = `sigtest-${Date.now().toString(36)}`;

const pair = KeyPair.generate();
const walletAddress = pair.publicKey.toAddress().toUserFriendlyAddress();
console.log(`\nbase    ${BASE}`);
console.log(`wallet  ${walletAddress}`);
console.log(`handle  @${handle}\n`);

const challengeResponse = await fetch(`${BASE}/api/auth/challenge`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ walletAddress, handle }),
});
const challenge = await challengeResponse.json();
if (!challenge.nonce) {
  console.error(`✕ challenge  ${challengeResponse.status}`, challenge);
  process.exit(1);
}
console.log(`✓ challenge  ${challengeResponse.status}`);

// Canonical Nimiq framing: 0x16 length byte + header with NO space after 0x16.
const prefix = "\x16Nimiq Signed Message:\n";
const payload = BufferUtils.fromUtf8(prefix + challenge.message.length + challenge.message);
const hash = Hash.computeSha256(payload);
const signature = Signature.create(pair.privateKey, pair.publicKey, hash);

// Verification hangs off the public key, not the signature. Assert it locally
// before blaming the server.
if (!pair.publicKey.verify(signature, hash)) {
  console.error("✕ local verify failed — the signing framing is wrong");
  process.exit(1);
}
console.log("✓ local verify");

const verifyResponse = await fetch(`${BASE}/api/auth/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    nonce: challenge.nonce,
    walletAddress,
    signature: signature.toHex(),
    publicKey: pair.publicKey.toHex(),
    language: "en",
  }),
});
const verified = await verifyResponse.json();
if (!verified.token) {
  console.error(`✕ verify     ${verifyResponse.status}`, verified);
  process.exit(1);
}
console.log(`✓ verify     ${verifyResponse.status} — session issued`);

const sessionResponse = await fetch(`${BASE}/api/contacts`, { headers: { Authorization: `Bearer ${verified.token}` } });
console.log(`${sessionResponse.ok ? "✓" : "✕"} session    ${sessionResponse.status} on an authenticated route`);

// The balance the UI shows is a live chain read, not a placeholder. A freshly
// generated wallet has never been funded, so the only correct answer is 0.
const balanceResponse = await fetch(`${BASE}/api/balance`, { headers: { Authorization: `Bearer ${verified.token}` } });
const balance = await balanceResponse.json();
const balanceOk = balanceResponse.ok && balance.nim === 0 && balance.lunas === 0;
console.log(`${balanceOk ? "✓" : "✕"} balance    ${balanceResponse.status} — ${JSON.stringify(balance)}\n`);

process.exitCode = sessionResponse.ok && balanceOk ? 0 : 1;
