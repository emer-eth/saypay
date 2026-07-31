import { applyGuards, type ParsedIntent } from "./intent-schema";

// Deterministic offline interpreter. Used when no model key is configured or
// the model call fails, so natural-language entry still works on a phone.

function handlesIn(input: string) {
  return [...new Set(Array.from(input.matchAll(/@([a-z0-9][a-z0-9-]{2,23})/gi)).map((match) => match[1].toLowerCase()))];
}

function amountIn(input: string) {
  const match = input.match(/(\d+(?:\.\d+)?)\s*(NIM|USDT|dollars?|\$)?/i);
  if (!match) return { amount: null as number | null, asset: "NIM" as const };
  const amount = Number(match[1]);
  const unit = (match[2] ?? "NIM").toUpperCase();
  const asset = unit === "USDT" || unit.startsWith("DOLLAR") || unit === "$" ? "USDT" as const : "NIM" as const;
  return { amount: Number.isFinite(amount) && amount > 0 ? amount : null, asset };
}

function noteIn(input: string) {
  const addressed = input.match(/\bfor\s+@[a-z0-9-]{3,24}\s+(?:for\s+)?(.+)$/i)?.[1]?.trim();
  const plain = input.match(/\b(?:for|after)\s+(.+)$/i)?.[1]?.replace(/\s+(?:with|by|and)\s+.*$/i, "").trim();
  const note = (addressed ?? plain ?? "").replace(/@([a-z0-9-]{3,24})/gi, "").replace(/\s+/g, " ").trim();
  return note || null;
}

function recipientHint(input: string, handles: string[]) {
  if (handles[0]) return `@${handles[0]}`;
  const named = input.match(/\b(?:to|for|with|pay)\s+([A-Za-z][A-Za-z0-9' -]{1,30}?)(?:\s+(?:for|after|by|with)\b|$)/i);
  return named?.[1]?.trim() || null;
}

export function parseLocalIntent(message: string): ParsedIntent {
  const text = message.trim();
  const lower = text.toLowerCase();
  const handles = handlesIn(text);
  const { amount, asset } = amountIn(text);
  const note = noteIn(text);

  let kind: ParsedIntent["kind"] = "send";
  if (/\b(protect|protected|escrow|arbiter|delivery milestone)\b/i.test(lower)) kind = "protected_pay";
  else if (/\bsplit\b/i.test(lower)) kind = "split";
  else if (/\binvoice\b/i.test(lower)) kind = "invoice";
  else if (/\b(request|ask .+ to pay|owe me)\b/i.test(lower)) kind = "request";

  const participants = kind === "split" || kind === "protected_pay"
    ? handles.map((handle) => `@${handle}`)
    : [];

  return applyGuards({
    kind,
    asset,
    amount,
    recipientHint: kind === "split" ? null : recipientHint(text, handles),
    participants: kind === "split" ? participants : kind === "protected_pay" ? participants.slice(1) : [],
    note,
    remindAt: null,
    confidence: "high",
    question: null,
  });
}
