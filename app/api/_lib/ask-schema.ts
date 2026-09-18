import { applyGuards, INTENT_KINDS, isActionable, type ParsedIntent, type TimerAction } from "./intent-schema";

export const FILE_SECTIONS = ["work", "you", "none"] as const;
export const FILE_KINDS = ["receipt", "note", "schedule_note", "upload", "task", "reminder", "expense", "none"] as const;
export const ASK_MONEY_KINDS = ["none", "send", "request", "split", "invoice", "protected_pay", "ledger", "timer"] as const;

export type FileSection = (typeof FILE_SECTIONS)[number];
export type FileKind = (typeof FILE_KINDS)[number];

export type AskFile = {
  section: "you";
  kind: Exclude<FileKind, "none">;
  title: string;
  body: string;
  dueAt: string | null;
};

export type AskChat = { handle: string; message: string };

export type AskResult = {
  reply: string;
  summary: string;
  file: AskFile | null;
  chat: AskChat | null;
  money: ParsedIntent | null;
  source: "gemini" | "local";
};

export const ASK_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "reply", "summary", "fileSection", "fileKind", "fileTitle", "fileBody", "fileDueAt",
    "chatHandle", "chatMessage",
    "kind", "amount", "recipientHint", "participants", "note", "remindAt", "timerAction", "confidence", "question",
  ],
  properties: {
    reply: { type: "string" },
    summary: { type: "string" },
    fileSection: { type: "string", enum: [...FILE_SECTIONS] },
    fileKind: { type: "string", enum: [...FILE_KINDS] },
    fileTitle: { type: ["string", "null"] },
    fileBody: { type: ["string", "null"] },
    fileDueAt: { type: ["string", "null"] },
    chatHandle: { type: ["string", "null"] },
    chatMessage: { type: ["string", "null"] },
    kind: { type: "string", enum: [...ASK_MONEY_KINDS] },
    amount: { type: ["number", "null"], minimum: 0 },
    recipientHint: { type: ["string", "null"] },
    participants: { type: "array", items: { type: "string" } },
    note: { type: ["string", "null"] },
    remindAt: { type: ["string", "null"] },
    timerAction: { type: ["string", "null"], enum: ["start", "stop", "bill", null] },
    confidence: { type: "string", enum: ["high", "needs_clarification"] },
    question: { type: ["string", "null"] },
  },
};

export function isMoneyKind(kind: string): kind is ParsedIntent["kind"] {
  return (INTENT_KINDS as readonly string[]).includes(kind);
}

export function validateAsk(raw: unknown, source: "gemini" | "local"): { ok: true; result: AskResult } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "empty" };
  const value = raw as Record<string, unknown>;
  const reply = typeof value.reply === "string" && value.reply.trim() ? value.reply.trim().slice(0, 800) : null;
  if (!reply) return { ok: false, error: "missing_reply" };
  const summary = (typeof value.summary === "string" && value.summary.trim() ? value.summary : reply).trim().slice(0, 120);

  const fileKind = FILE_KINDS.includes(value.fileKind as FileKind) ? value.fileKind as FileKind : "none";
  let file: AskFile | null = null;
  if (fileKind !== "none") {
    const title = (typeof value.fileTitle === "string" && value.fileTitle.trim() ? value.fileTitle : fileKind).slice(0, 80);
    const body = (typeof value.fileBody === "string" ? value.fileBody : "").trim().slice(0, 1_000);
    const dueAt = typeof value.fileDueAt === "string" && value.fileDueAt.trim() ? value.fileDueAt.trim().slice(0, 40) : null;
    file = { section: "you", kind: fileKind, title, body, dueAt };
  }
  let chat: AskChat | null = null;
  const chatHandle = typeof value.chatHandle === "string" ? value.chatHandle.replace(/^@/, "").trim().toLowerCase() : "";
  const chatMessage = typeof value.chatMessage === "string" ? value.chatMessage.trim().slice(0, 500) : "";
  if (chatHandle.length >= 3 && chatMessage) chat = { handle: chatHandle, message: chatMessage };

  let money: ParsedIntent | null = null;
  const kind = typeof value.kind === "string" ? value.kind : "none";
  if (isMoneyKind(kind)) {
    const timerAction = value.timerAction === "start" || value.timerAction === "stop" || value.timerAction === "bill"
      ? value.timerAction as TimerAction
      : kind === "timer" ? "start" as const : null;
    const amount = typeof value.amount === "number" && Number.isFinite(value.amount) ? value.amount : null;
    money = applyGuards({
      kind,
      asset: "NIM",
      amount,
      recipientHint: typeof value.recipientHint === "string" ? value.recipientHint : null,
      participants: Array.isArray(value.participants) ? value.participants.filter((p): p is string => typeof p === "string") : [],
      note: typeof value.note === "string" ? value.note : null,
      remindAt: typeof value.remindAt === "string" ? value.remindAt : null,
      recurrence: value.recurrence === "weekly" ? "weekly" : "once",
      timerAction,
      confidence: value.confidence === "needs_clarification" ? "needs_clarification" : "high",
      question: typeof value.question === "string" ? value.question : null,
    });
  }

  return { ok: true, result: { reply, summary, file, chat, money, source } };
}

export function needsConfirm(result: AskResult) {
  return moneyNeedsConfirm(result.money) || Boolean(result.chat);
}

export function moneyNeedsConfirm(money: ParsedIntent | null) {
  if (!money) return false;
  if (money.kind === "ledger") return false;
  return money.confidence === "high" && isActionable(money);
}
