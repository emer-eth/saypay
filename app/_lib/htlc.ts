import { nimToLunas } from "./units";

// Protected Pay on the NIM rail, backed by Nimiq HTLCs.
//
// Status: these five provider methods exist in Nimiq's fork of
// trust-web3-provider but sit on an unmerged `htlc` branch, and they are absent
// from the published @nimiq/mini-app-sdk typings. The host injects the provider
// at runtime, so they may still be there — always feature-detect, and fall back
// to USDT on Polygon when they are not.
//
// Three resolution paths, matching the contract itself:
//   preimage — the recipient claims by revealing the secret
//   early    — sender and recipient co-sign a cooperative release
//   timeout  — the sender reclaims after the deadline block
//
// There is no on-chain arbiter vote. Arbiters act off-chain by releasing the
// preimage or co-signing. Say that plainly in the UI rather than implying the
// chain enforces their decision.

const HTLC_METHODS = ["sendNewHtlcTransaction", "sendRedeemRegularHtlcTransaction", "sendRedeemTimeoutHtlcTransaction", "sendRedeemEarlyHtlcTransaction", "signRedeemEarlyHtlcTransaction"] as const;

export type HashAlgorithm = "blake2b" | "sha256" | "sha512";

export type EscrowResult = { ok: true; value: string } | { ok: false; reason: "rejected" | "unsupported" | "not_in_host" | "error"; message: string };

type HtlcProvider = Record<string, (tx: Record<string, unknown>) => Promise<unknown>>;

function provider() {
  return (window as unknown as { nimiq?: HtlcProvider }).nimiq ?? null;
}

function htlcProvider() {
  const injected = provider();
  if (!injected) return null;
  return HTLC_METHODS.every((method) => typeof injected[method] === "function") ? injected : null;
}

// Which methods the running host actually exposes. Surface this in diagnostics
// rather than guessing from the SDK version.
export function detectHtlcMethods() {
  const injected = provider();
  return Object.fromEntries(HTLC_METHODS.map((method) => [method, Boolean(injected && typeof injected[method] === "function")]));
}

export function isEscrowSupported() {
  return htlcProvider() !== null;
}

function looksRejected(value: unknown) {
  const text = (value instanceof Error ? value.message : String(value)).toLowerCase();
  return text.includes("reject") || text.includes("denied") || text.includes("cancel") || text.includes("abort");
}

async function call(run: () => Promise<unknown>): Promise<EscrowResult> {
  try {
    const result = await run();
    if (typeof result === "object" && result !== null && "error" in result) {
      const message = String((result as { error: unknown }).error);
      return { ok: false, reason: looksRejected(message) ? "rejected" : "error", message };
    }
    return { ok: true, value: String(result) };
  } catch (error) {
    return { ok: false, reason: looksRejected(error) ? "rejected" : "error", message: error instanceof Error ? error.message : String(error) };
  }
}

const unsupported: EscrowResult = { ok: false, reason: "unsupported", message: "Protected Pay on NIM needs HTLC support, which this version of Nimiq Pay does not expose yet." };

// Lock funds. `timeoutBlock` is an absolute block height, not a duration.
export async function openEscrow(terms: { recipient: string; amount: number; timeoutBlock: number; hashRoot: string; hashCount: number; hashAlgorithm: HashAlgorithm }) {
  const injected = htlcProvider();
  if (!injected) return unsupported;
  return call(() => injected.sendNewHtlcTransaction({ htlcRecipient: terms.recipient.replace(/\s/g, "").toUpperCase(), hashRoot: terms.hashRoot, hashCount: terms.hashCount, hashAlgorithm: terms.hashAlgorithm, timeout: terms.timeoutBlock, value: nimToLunas(terms.amount) }));
}

export async function redeemWithPreimage(args: { contractAddress: string; preImage: string; hashRoot: string; hashCount: number; hashAlgorithm: HashAlgorithm; amount: number }) {
  const injected = htlcProvider();
  if (!injected) return unsupported;
  return call(() => injected.sendRedeemRegularHtlcTransaction({ contractAddress: args.contractAddress, preImage: args.preImage, hashRoot: args.hashRoot, hashCount: args.hashCount, hashAlgorithm: args.hashAlgorithm, value: nimToLunas(args.amount) }));
}

// Half of a cooperative release. Both parties produce one of these, then either
// submits both together.
export async function signEarlyRelease(args: { contractAddress: string; amount: number; validityStartHeight: number; recipient?: string }) {
  const injected = htlcProvider();
  if (!injected) return unsupported;
  return call(() => injected.signRedeemEarlyHtlcTransaction({ contractAddress: args.contractAddress, recipient: args.recipient, value: nimToLunas(args.amount), validityStartHeight: args.validityStartHeight }));
}

export async function submitEarlyRelease(args: { contractAddress: string; amount: number; validityStartHeight: number; htlcSenderSignature: string; htlcRecipientSignature: string; recipient?: string }) {
  const injected = htlcProvider();
  if (!injected) return unsupported;
  return call(() => injected.sendRedeemEarlyHtlcTransaction({ contractAddress: args.contractAddress, recipient: args.recipient, htlcSenderSignature: args.htlcSenderSignature, htlcRecipientSignature: args.htlcRecipientSignature, value: nimToLunas(args.amount), validityStartHeight: args.validityStartHeight }));
}

export async function refundAfterTimeout(args: { contractAddress: string; amount: number; recipient?: string }) {
  const injected = htlcProvider();
  if (!injected) return unsupported;
  return call(() => injected.sendRedeemTimeoutHtlcTransaction({ contractAddress: args.contractAddress, recipient: args.recipient, value: nimToLunas(args.amount) }));
}
