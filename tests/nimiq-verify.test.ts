import assert from "node:assert/strict";
import test from "node:test";
import { BufferUtils, Hash, KeyPair, Signature } from "@nimiq/core";
import { addressFromPublicKey, verifySignedMessageDetailed } from "../app/api/_lib/nimiq-verify";

test("canonical Nimiq signed-message framing verifies", async () => {
  const pair = KeyPair.generate();
  const message = `SayPay profile claim | @sigtest | ${pair.publicKey.toAddress().toUserFriendlyAddress()} | nonce`;
  const prefix = "\x16Nimiq Signed Message:\n";
  const payload = BufferUtils.fromUtf8(prefix + message.length + message);
  const hash = Hash.computeSha256(payload);
  const signature = Signature.create(pair.privateKey, pair.publicKey, hash);
  const verified = await verifySignedMessageDetailed(message, signature.toHex(), pair.publicKey.toHex());
  assert.equal(verified.ok, true);
  assert.equal(
    addressFromPublicKey(pair.publicKey.toHex()).replace(/\s/g, ""),
    pair.publicKey.toAddress().toUserFriendlyAddress().replace(/\s/g, ""),
  );
});

test("tampered signature is rejected", async () => {
  const pair = KeyPair.generate();
  const verified = await verifySignedMessageDetailed("hello", "00".repeat(64), pair.publicKey.toHex());
  assert.equal(verified.ok, false);
});
