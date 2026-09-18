export type EscrowVote = "release" | "refund";

export type EscrowResolution =
  | { status: "awaiting_escrows"; winner: null; vote: null }
  | { status: "needs_ai"; winner: null; vote: null }
  | { status: "release_recommended" | "refund_recommended"; winner: "humans" | "ai"; vote: EscrowVote };

export function resolveEscrowVotes(input: {
  creatorEscrowVote: EscrowVote | null;
  counterpartyEscrowVote: EscrowVote | null;
  aiVote: EscrowVote | null;
}): EscrowResolution {
  const a = input.creatorEscrowVote;
  const b = input.counterpartyEscrowVote;
  if (!a || !b) return { status: "awaiting_escrows", winner: null, vote: null };
  if (a === b) {
    return { status: a === "release" ? "release_recommended" : "refund_recommended", winner: "humans", vote: a };
  }
  if (!input.aiVote) return { status: "needs_ai", winner: null, vote: null };
  return {
    status: input.aiVote === "release" ? "release_recommended" : "refund_recommended",
    winner: "ai",
    vote: input.aiVote,
  };
}

export function conversationPair(left: string, right: string) {
  const a = left.replace(/\s/g, "").toUpperCase();
  const b = right.replace(/\s/g, "").toUpperCase();
  if (!a || !b || a === b) return null;
  return a < b ? { a, b } : { a: b, b: a };
}
