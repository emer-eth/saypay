// The intent boundary. The model turns a sentence into one of these objects and
// nothing more: it never moves funds, never picks a recipient, and never
// resolves an address. Everything crossing this boundary is validated here,
// because model output is untrusted input.

export const INTENT_KINDS = ["send", "request", "split", "invoice", "protected_pay"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export const ASSETS = ["NIM", "USDT"] as const;
export type IntentAsset = (typeof ASSETS)[number];

export type Confidence = "high" | "needs_clarification";

export type ParsedIntent = {
  kind: IntentKind;
  asset: IntentAsset;
  // Whole units the user said, not Lunas. Null when unstated.
  amount: number | null;
  // What the user actually called them — "Mum", "@ada", or a literal address.
  // Turning this into a wallet address is the app's job, never the model's.
  recipientHint: string | null;
  participants: string[];
  note: string | null;
  remindAt: string | null;
  confidence: Confidence;
  // Exactly one question when confidence is needs_clarification.
  question: string | null;
};

// Not `as const`: jsonSchema() expects a mutable JSONSchema7, and a readonly
// `required` tuple is not assignable to it.
export const INTENT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "asset", "amount", "recipientHint", "participants", "note", "remindAt", "confidence", "question"],
  properties: {
    kind: { type: "string", enum: [...INTENT_KINDS] },
    asset: { type: "string", enum: [...ASSETS] },
    amount: { type: ["number", "null"], minimum: 0 },
    recipientHint: { type: ["string", "null"] },
    participants: { type: "array", items: { type: "string" } },
    note: { type: ["string", "null"] },
    remindAt: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "needs_clarification"] },
    question: { type: ["string", "null"] },
  },
};

export type ValidationResult = { ok: true; intent: ParsedIntent } | { ok: false; error: string };

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

// Reject anything malformed rather than coercing it. A half-understood payment
// instruction is worse than no answer at all.
export function validateIntent(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Expected an object." };
  const value = raw as Record<string, unknown>;

  if (!INTENT_KINDS.includes(value.kind as IntentKind)) return { ok: false, error: `Unknown intent: ${String(value.kind)}` };
  if (!ASSETS.includes(value.asset as IntentAsset)) return { ok: false, error: `Unknown asset: ${String(value.asset)}` };

  const amount = value.amount;
  if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)) return { ok: false, error: "Amount must be a positive number or null." };

  if (!isStringOrNull(value.recipientHint)) return { ok: false, error: "recipientHint must be a string or null." };
  if (!isStringOrNull(value.note)) return { ok: false, error: "note must be a string or null." };
  if (!isStringOrNull(value.remindAt)) return { ok: false, error: "remindAt must be a string or null." };
  if (!isStringOrNull(value.question)) return { ok: false, error: "question must be a string or null." };
  if (!Array.isArray(value.participants) || !value.participants.every((entry) => typeof entry === "string")) return { ok: false, error: "participants must be an array of strings." };
  if (value.confidence !== "high" && value.confidence !== "needs_clarification") return { ok: false, error: `Unknown confidence: ${String(value.confidence)}` };
  if (value.remindAt !== null && Number.isNaN(Date.parse(value.remindAt))) return { ok: false, error: "remindAt must be an ISO-8601 date or null." };

  return {
    ok: true,
    intent: applyGuards({
      kind: value.kind as IntentKind,
      asset: value.asset as IntentAsset,
      amount: (amount as number | null) ?? null,
      recipientHint: value.recipientHint,
      participants: value.participants as string[],
      note: value.note,
      remindAt: value.remindAt,
      confidence: value.confidence,
      question: value.question,
    }),
  };
}

// Structural guards the model does not get a vote on. If a human still has to
// supply something, we downgrade to a question however confident it claimed to be.
export function applyGuards(intent: ParsedIntent): ParsedIntent {
  const missing: string[] = [];
  if (intent.amount === null) missing.push("amount");
  if (intent.kind === "split") {
    if (intent.participants.length === 0) missing.push("who to split with");
  } else if (intent.recipientHint === null) {
    missing.push("recipient");
  }

  if (missing.length > 0) return { ...intent, confidence: "needs_clarification", question: intent.question ?? `I still need the ${missing.join(" and ")}. What should it be?` };
  if (intent.confidence === "high") return { ...intent, question: null };
  return intent;
}

// Does this intent have everything needed to build an action card?
export function isActionable(intent: ParsedIntent) {
  if (intent.confidence !== "high") return false;
  if (intent.amount === null || intent.amount <= 0) return false;
  if (intent.kind === "split") return intent.participants.length > 0;
  return intent.recipientHint !== null;
}
