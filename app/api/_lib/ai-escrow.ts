import { generateText, Output, jsonSchema, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { readEnv } from "./env";
import type { EscrowVote } from "./escrow-resolve";

function resolveModel(): LanguageModel | null {
  const key = readEnv("ANTHROPIC_API_KEY");
  const gateway = readEnv("AI_GATEWAY_API_KEY");
  const modelId = readEnv("SAYPAY_MODEL") ?? "claude-sonnet-4-5";
  if (key) return createAnthropic({ apiKey: key })(modelId);
  if (gateway) return `anthropic/${modelId}`;
  return null;
}

export type AiEscrowResult =
  | { ok: true; vote: EscrowVote; reason: string }
  | { ok: false; error: string; code: "ai_offline" | "ai_failed" };

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["vote", "reason"],
  properties: {
    vote: { type: "string", enum: ["release", "refund"] },
    reason: { type: "string" },
  },
};

export async function aiEscrowDecide(input: {
  terms: string;
  amountNim: number;
  evidence: Array<{ author: string; body: string }>;
  creatorEscrowVote: EscrowVote;
  counterpartyEscrowVote: EscrowVote;
}): Promise<AiEscrowResult> {
  const model = resolveModel();
  if (!model) {
    return {
      ok: false,
      code: "ai_offline",
      error: "SayPay AI escrow is offline until an API key is set. The two nominated escrows must agree.",
    };
  }
  try {
    const { output } = await generateText({
      model,
      system: `You are SayPay's tiebreaker escrow. You never move NIM. You only recommend release or refund.

Release: pay the counterparty (the worker). Refund: return NIM to the creator (the client).
The two human escrows disagreed. Decide only from the written terms and evidence.
If evidence is missing, weak, or contradictory, recommend refund.
Reason: one or two short sentences. No legal advice.`,
      maxRetries: 2,
      output: Output.object({ schema: jsonSchema<{ vote: EscrowVote; reason: string }>(SCHEMA) }),
      prompt: [
        `Amount: ${input.amountNim} NIM`,
        `Creator escrow voted: ${input.creatorEscrowVote}`,
        `Counterparty escrow voted: ${input.counterpartyEscrowVote}`,
        "",
        "Terms:",
        input.terms,
        "",
        "Evidence:",
        input.evidence.length
          ? input.evidence.map((row) => `- ${row.author}: ${row.body}`).join("\n")
          : "(none)",
      ].join("\n"),
    });
    if (output.vote !== "release" && output.vote !== "refund") {
      return { ok: false, code: "ai_failed", error: "The AI escrow did not return a valid vote." };
    }
    return { ok: true, vote: output.vote, reason: (output.reason ?? "").trim().slice(0, 400) || "Tie broken from the written terms." };
  } catch (error) {
    return {
      ok: false,
      code: "ai_failed",
      error: error instanceof Error ? error.message : "The AI escrow could not decide.",
    };
  }
}
