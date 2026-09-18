import { applyGuards, type ParsedIntent } from "./intent-schema";
import { isValidNimiqAddress } from "../../_lib/units";

function handlesIn(input: string) {
  return [...new Set(Array.from(input.matchAll(/@([a-z0-9][a-z0-9-]{2,23})/gi)).map((match) => match[1].toLowerCase()))];
}

function looksForeignAsset(input: string) {
  return /(?:\bUSDT\b|\bUSD\b|\bdollars?\b|\$)/i.test(input);
}

function amountIn(input: string) {
  const dollarFirst = input.match(/\$\s*(\d+(?:\.\d+)?)/);
  const unitAfter = input.match(/(\d+(?:\.\d+)?)\s*(NIM|USDT|USD|dollars?|\$)/i);
  const bare = input.match(/(?:send|pay|transfer|invoice|split|request)\s+(?:@?\S+\s+)?(\d+(?:\.\d+)?)/i)
    ?? input.match(/(\d+(?:\.\d+)?)\s*(?:NIM)?/i);
  const amount = Number(dollarFirst?.[1] ?? unitAfter?.[1] ?? bare?.[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function noteIn(input: string) {
  const addressed = input.match(/\bfor\s+@[a-z0-9-]{3,24}\s+(?:for\s+)?(.+)$/i)?.[1]?.trim();
  const plain = input.match(/\b(?:for|after)\s+(.+)$/i)?.[1]?.replace(/\s+(?:with|by|and)\s+.*$/i, "").trim();
  const note = (addressed ?? plain ?? "").replace(/@([a-z0-9-]{3,24})/gi, "").replace(/\s+/g, " ").trim();
  return note || null;
}

function splitNames(raw: string) {
  return raw
    .split(/\s*(?:,|&|\band\b|\by\b|\bet\b)\s*/i)
    .map((part) => part.replace(/[.?!:].*$/, "").replace(/\b(?:for|after|by)\b.*$/i, "").trim())
    .filter((part) => part.length >= 2 && !/^(nim|usdt|usd|the|a|an)$/i.test(part));
}

function peopleAfter(input: string, keyword: string) {
  const match = input.match(new RegExp(`\\b${keyword}\\s+(.+)$`, "i"));
  if (!match) return [];
  return splitNames(match[1]);
}

function recipientHint(input: string, handles: string[]): string | null {
  if (handles[0]) return `@${handles[0]}`;
  const addressed = input.match(/\b(?:send|pay|transfer|invoice)\b[\s\S]{0,160}?\bto\s+(NQ[0-9]{2}(?:\s*[0-9A-HJ-NP-VXY]{4}){8})/i)?.[1];
  if (addressed && isValidNimiqAddress(addressed)) {
    return addressed.replace(/\s+/g, " ").toUpperCase();
  }
  const sendName = input.match(/^(?:send|pay|transfer|invoice)\s+(@?[A-Za-zÁÉÍÓÚÑáéíóúñ][\w'À-ÿ-]*)\b/i);
  if (sendName) return sendName[1].replace(/^@/, "");
  const named = input.match(/\b(?:to|for|with|pay)\s+(@?[A-Za-zÁÉÍÓÚÑáéíóúñ][\w'À-ÿ -]{0,40}?)(?:\s+(?:for|after|by|with|when)\b|$)/i);
  if (named) {
    const value = named[1].trim().replace(/^@/, "");
    if (value && !/^(nim|usdt|usd|the)$/i.test(value)) return value;
  }
  return null;
}

function hoursIn(input: string) {
  const match = input.match(/(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)\b/i);
  const hours = match ? Number(match[1]) : null;
  return hours && Number.isFinite(hours) && hours > 0 ? hours : null;
}

function hourlyRateIn(input: string) {
  const match = input.match(/(?:at|@)\s*(\d+(?:\.\d+)?)\s*(?:NIM)?(?:\s*(?:\/\s*h(?:r|our)?s?|an hour|per hour|hourly))?/i)
    ?? input.match(/(\d+(?:\.\d+)?)\s*NIM\s*(?:\/\s*h(?:r|our)?s?|an hour|per hour|hourly)/i);
  const rate = match ? Number(match[1]) : null;
  return rate && Number.isFinite(rate) && rate > 0 ? rate : null;
}

function remindAt(input: string) {
  const now = Date.now();
  if (/\btomorrow\b/i.test(input)) return new Date(now + 24 * 60 * 60 * 1000).toISOString();
  if (/\bnext week\b|\bin a week\b/i.test(input)) return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  const iso = input.match(/\b(20\d{2}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)/);
  if (iso) {
    const parsed = Date.parse(iso[1]);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function detectQuestionLanguage(input: string, missing: string[]) {
  if (/[áéíóúñ¿¡]|\b(envía|enviar|dinero|mamá|cuánto)\b/i.test(input)) {
    if (missing.includes("amount") && missing.includes("recipient")) return "¿Cuánto y a quién lo envío?";
    if (missing.includes("amount")) return "¿Cuánto NIM debo enviar?";
    return "¿A quién debo enviarlo?";
  }
  return null;
}

export function parseLocalIntent(message: string): ParsedIntent {
  const text = message.trim();
  const lower = text.toLowerCase();
  const handles = handlesIn(text);
  const amount = amountIn(text);
  const note = noteIn(text);
  const foreign = looksForeignAsset(text);

  let kind: ParsedIntent["kind"] = "send";
  let timerAction: ParsedIntent["timerAction"] = null;
  const hours = hoursIn(text);
  const rate = hourlyRateIn(text);

  if (/\b(protect(?:ed)?|escrow|arbiters?|delivery milestone)\b/i.test(lower) || /\bwhen\s+(?:she|he|they|it)\s+deliver/i.test(lower)) {
    kind = "protected_pay";
  } else if (/\b(what'?s overdue|overdue|what do i owe|what am i owed|what'?s due|money (?:in|out))\b/i.test(lower)) {
    kind = "ledger";
  } else if (/\bstop(?:ping)? (?:the |my )?timer\b|\btimer off\b/i.test(lower)) {
    kind = "timer";
    timerAction = "stop";
  } else if (/\bbill (?:my |the )?timer\b|\binvoice (?:my |the )?(?:time|timer)\b/i.test(lower)) {
    kind = "timer";
    timerAction = "bill";
  } else if (/\bstart(?:ing)? (?:a |the )?timer\b|\btrack time\b|\btime track/i.test(lower)) {
    kind = "timer";
    timerAction = "start";
  } else if (/\bsplit\b/i.test(lower)) kind = "split";
  else if (/\binvoice\b/i.test(lower) || (/\bbill\b/i.test(lower) && hours && rate)) kind = "invoice";
  else if (/\b(request|owe me|ask .+ to pay)\b/i.test(lower)) kind = "request";

  const namedPeople = kind === "split"
    ? [...handles.map((h) => `@${h}`), ...peopleAfter(text, "with"), ...peopleAfter(text, "between")]
    : [];
  const participants = [...new Set(namedPeople.map((p) => p.replace(/^@/, "")).filter(Boolean))].map((p) =>
    /^[a-z0-9-]{3,24}$/.test(p) && handles.includes(p) ? `@${p}` : p.startsWith("@") ? p : p,
  );

  const hint = kind === "split" || kind === "ledger" || (kind === "timer" && timerAction !== "start")
    ? null
    : recipientHint(text, handles);
  const recurrence = /\b(every week|weekly|each week)\b/i.test(lower) ? "weekly" as const : "once" as const;

  let resolvedAmount = amount;
  let resolvedNote = note;
  if (kind === "timer" && timerAction === "start") {
    resolvedAmount = rate;
  } else if (kind === "timer") {
    resolvedAmount = null;
  } else if (kind === "ledger") {
    resolvedAmount = null;
  } else if (kind === "invoice" && hours && rate) {
    resolvedAmount = Number((hours * rate).toFixed(5));
    const billed = `${hours}h × ${rate} NIM/h`;
    resolvedNote = note && !note.includes("h ×") ? `${billed} — ${note}` : billed;
  }

  const draft: ParsedIntent = {
    kind,
    asset: "NIM",
    amount: resolvedAmount,
    recipientHint: hint,
    participants: kind === "split" ? participants : kind === "protected_pay" ? participants.slice(1) : [],
    note: resolvedNote,
    remindAt: kind === "ledger" || kind === "timer" ? null : remindAt(text),
    recurrence,
    timerAction,
    confidence: "high",
    question: null,
  };

  const guarded = applyGuards(draft, { mentionedForeign: foreign });
  if (guarded.confidence === "needs_clarification" && !foreign && kind !== "ledger" && kind !== "timer") {
    const missing: string[] = [];
    if (guarded.amount === null) missing.push("amount");
    if (kind === "split" && guarded.participants.length === 0) missing.push("who");
    else if (kind !== "split" && !guarded.recipientHint) missing.push("recipient");
    const localized = detectQuestionLanguage(text, missing);
    if (localized) return { ...guarded, question: localized };
  }
  return guarded;
}
