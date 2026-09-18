export const INTENT_KINDS = ["send", "request", "split", "invoice", "protected_pay", "ledger", "timer"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];
export const TIMER_ACTIONS = ["start", "stop", "bill"] as const;
export type TimerAction = (typeof TIMER_ACTIONS)[number];

export const ASSETS = ["NIM"] as const;
export type IntentAsset = (typeof ASSETS)[number];

export type Confidence = "high" | "needs_clarification";

export type ParsedIntent = {
  kind: IntentKind;
  asset: IntentAsset;
  amount: number | null;
  recipientHint: string | null;
  participants: string[];
  note: string | null;
  remindAt: string | null;
  recurrence: "once" | "weekly";
  timerAction: TimerAction | null;
  confidence: Confidence;
  question: string | null;
};

export const INTENT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "asset", "amount", "recipientHint", "participants", "note", "remindAt", "timerAction", "confidence", "question"],
  properties: {
    kind: { type: "string", enum: [...INTENT_KINDS] },
    asset: { type: "string", enum: ["NIM", "USDT"] },
    amount: { type: ["number", "null"], minimum: 0 },
    recipientHint: { type: ["string", "null"] },
    participants: { type: "array", items: { type: "string" } },
    note: { type: ["string", "null"] },
    remindAt: { type: ["string", "null"] },
    recurrence: { type: "string", enum: ["once", "weekly"] },
    timerAction: { type: ["string", "null"], enum: ["start", "stop", "bill", null] },
    confidence: { type: "string", enum: ["high", "needs_clarification"] },
    question: { type: ["string", "null"] },
  },
};

export type ValidationResult = { ok: true; intent: ParsedIntent } | { ok: false; error: string };

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function validateIntent(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Expected an object." };
  const value = raw as Record<string, unknown>;

  if (!INTENT_KINDS.includes(value.kind as IntentKind)) return { ok: false, error: `Unknown intent: ${String(value.kind)}` };

  const amount = value.amount;
  if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)) {
    return { ok: false, error: "Amount must be a positive number or null." };
  }

  if (!isStringOrNull(value.recipientHint)) return { ok: false, error: "recipientHint must be a string or null." };
  if (!isStringOrNull(value.note)) return { ok: false, error: "note must be a string or null." };
  if (!isStringOrNull(value.remindAt)) return { ok: false, error: "remindAt must be a string or null." };
  if (!isStringOrNull(value.question)) return { ok: false, error: "question must be a string or null." };
  if (!Array.isArray(value.participants) || !value.participants.every((entry) => typeof entry === "string")) {
    return { ok: false, error: "participants must be an array of strings." };
  }
  if (value.confidence !== "high" && value.confidence !== "needs_clarification") {
    return { ok: false, error: `Unknown confidence: ${String(value.confidence)}` };
  }
  if (value.remindAt !== null && Number.isNaN(Date.parse(value.remindAt))) {
    return { ok: false, error: "remindAt must be an ISO-8601 date or null." };
  }

  if (value.asset != null && value.asset !== "NIM" && value.asset !== "USDT") {
    return { ok: false, error: `Unknown asset: ${String(value.asset)}` };
  }
  const mentionedForeign = value.asset === "USDT";
  const recurrence = value.recurrence === "weekly" ? "weekly" as const : "once" as const;
  const timerAction = TIMER_ACTIONS.includes(value.timerAction as TimerAction)
    ? value.timerAction as TimerAction
    : value.kind === "timer" ? "start" as const : null;

  return {
    ok: true,
    intent: applyGuards({
      kind: value.kind as IntentKind,
      asset: "NIM",
      amount: (amount as number | null) ?? null,
      recipientHint: value.recipientHint,
      participants: (value.participants as string[]).map((p) => p.trim()).filter(Boolean),
      note: value.note,
      remindAt: value.remindAt,
      recurrence,
      timerAction,
      confidence: value.confidence,
      question: mentionedForeign
        ? (value.question ?? "SayPay settles in NIM on the Nimiq chain. How many NIM should I send?")
        : value.question,
    }, { mentionedForeign }),
  };
}

export function applyGuards(intent: ParsedIntent, options: { mentionedForeign?: boolean } = {}): ParsedIntent {
  if (options.mentionedForeign) {
    return {
      ...intent,
      asset: "NIM",
      confidence: "needs_clarification",
      question: intent.question ?? "SayPay settles in NIM on the Nimiq chain. How many NIM should I send?",
    };
  }

  if (intent.kind === "ledger") {
    return { ...intent, timerAction: null, confidence: "high", question: null };
  }

  const missing: string[] = [];
  if (intent.kind === "timer") {
    const action = intent.timerAction ?? "start";
    if (action === "start") {
      if (!intent.recipientHint) missing.push("who you are working for");
      if (intent.amount === null) missing.push("hourly rate in NIM");
    }
  } else if (intent.kind === "split") {
    if (intent.amount === null) missing.push("amount");
    if (intent.participants.length === 0) missing.push("who to split with");
  } else {
    if (intent.amount === null) missing.push("amount");
    if (!intent.recipientHint) missing.push("recipient");
  }

  if (missing.length > 0) {
    return {
      ...intent,
      confidence: "needs_clarification",
      question: intent.question ?? `I still need the ${missing.join(" and ")}. What should it be?`,
    };
  }
  if (intent.confidence === "high") return { ...intent, question: null };
  return intent;
}

export function isActionable(intent: ParsedIntent) {
  if (intent.confidence !== "high") return false;
  if (intent.kind === "ledger") return true;
  if (intent.kind === "timer") {
    const action = intent.timerAction ?? "start";
    if (action === "stop" || action === "bill") return true;
    return Boolean(intent.recipientHint) && intent.amount != null && intent.amount > 0;
  }
  if (intent.amount === null || intent.amount <= 0) return false;
  if (intent.kind === "split") return intent.participants.length > 0;
  return intent.recipientHint !== null;
}
