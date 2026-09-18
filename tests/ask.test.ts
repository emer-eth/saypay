import assert from "node:assert/strict";
import test from "node:test";
import { moneyNeedsConfirm, validateAsk } from "../app/api/_lib/ask-schema";

test("ask schema files a receipt without treating it as money", () => {
  const parsed = validateAsk({
    reply: "I saved “Lunch” in You as a receipt.",
    summary: "Receipt · Lunch",
    fileSection: "you",
    fileKind: "receipt",
    fileTitle: "Lunch",
    fileBody: "12 NIM",
    fileDueAt: null,
    chatHandle: null,
    chatMessage: null,
    kind: "none",
    amount: null,
    recipientHint: null,
    participants: [],
    note: null,
    remindAt: null,
    timerAction: null,
    confidence: "high",
    question: null,
  }, "gemini");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.result.file?.kind, "receipt");
  assert.equal(parsed.result.money, null);
  assert.equal(moneyNeedsConfirm(parsed.result.money), false);
});

test("ask schema requires confirmation for a send", () => {
  const parsed = validateAsk({
    reply: "Confirm sending 20 NIM to @maya.",
    summary: "Send 20 NIM · @maya",
    fileSection: "none",
    fileKind: "none",
    fileTitle: null,
    fileBody: null,
    fileDueAt: null,
    chatHandle: null,
    chatMessage: null,
    kind: "send",
    amount: 20,
    recipientHint: "@maya",
    participants: [],
    note: "lunch",
    remindAt: null,
    timerAction: null,
    confidence: "high",
    question: null,
  }, "gemini");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.result.money?.kind, "send");
  assert.equal(moneyNeedsConfirm(parsed.result.money), true);
});

test("ask schema prepares a chat request without sending it", () => {
  const parsed = validateAsk({
    reply: "Confirm sending a chat request to @maya.",
    summary: "Chat request · @maya",
    fileSection: "none",
    fileKind: "none",
    fileTitle: null,
    fileBody: null,
    fileDueAt: null,
    chatHandle: "@maya",
    chatMessage: "Can we talk about the invoice?",
    kind: "none",
    amount: null,
    recipientHint: null,
    participants: [],
    note: null,
    remindAt: null,
    timerAction: null,
    confidence: "high",
    question: null,
  }, "gemini");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.result.chat?.handle, "maya");
  assert.equal(parsed.result.money, null);
});
