import { formatNimiqAddress, isValidNimiqAddress, nimToLunas, normaliseNimiqAddress } from "../_lib/units";
import { detectHtlcMethods, isEscrowSupported, openEscrow, redeemWithPreimage, refundAfterTimeout, signEarlyRelease, submitEarlyRelease, type HashAlgorithm } from "../_lib/htlc";

export type WalletErrorReason = "rejected" | "unsupported" | "not_in_host" | "error";

export class WalletError extends Error {
  constructor(public reason: WalletErrorReason, message: string) {
    super(message);
    this.name = "WalletError";
  }
}

type ErrorResponse = { error: { type?: string; message: string } };

function isErrorResponse(value: unknown): value is ErrorResponse {
  return typeof value === "object" && value !== null && "error" in value;
}

function looksRejected(value: unknown) {
  const type = typeof value === "object" && value !== null && "type" in value ? String((value as { type?: unknown }).type) : "";
  const text = (value instanceof Error ? value.message : isErrorResponse(value) ? value.error.message : String(value)).toLowerCase();
  return /reject|denied|cancel|abort/.test(`${type} ${text}`.toLowerCase());
}

/**
 * SDK 0.2+ returns values directly and throws NimiqProviderError on failure; older hosts returned
 * `{ error }` objects. Both paths end as a WalletError with a clear reason, never a raw exception.
 */
async function hostCall<T>(run: () => Promise<T>, fallback: string): Promise<T> {
  let result: T;
  try {
    result = await run();
  } catch (error) {
    if (error instanceof WalletError) throw error;
    const message = error instanceof Error && error.message ? error.message : fallback;
    throw new WalletError(looksRejected(error) ? "rejected" : "error", message);
  }
  if (isErrorResponse(result)) {
    throw new WalletError(looksRejected(result) ? "rejected" : "error", result.error.message || fallback);
  }
  return result;
}

async function provider() {
  if (typeof window === "undefined") throw new WalletError("not_in_host", "Open SayPay inside Nimiq Pay.");
  const { init } = await import("@nimiq/mini-app-sdk");
  return init();
}

function unwrap(result: unknown, fallback: string) {
  if (isErrorResponse(result)) {
    throw new WalletError(looksRejected(result) ? "rejected" : "error", result.error.message || fallback);
  }
  if (typeof result !== "string" || !result) throw new WalletError("error", fallback);
  return result;
}

export async function listAccounts() {
  try {
    const nimiq = await provider();
    const accounts: unknown = await hostCall(() => nimiq.listAccounts(), "Nimiq Pay did not return an account.");
    if (!Array.isArray(accounts) || !accounts[0]) throw new WalletError("error", "No Nimiq account is available.");
    return accounts.map((address) => formatNimiqAddress(address));
  } catch (error) {
    if (error instanceof WalletError) throw error;
    throw new WalletError(looksRejected(error) ? "rejected" : "not_in_host", error instanceof Error ? error.message : "Open SayPay inside Nimiq Pay.");
  }
}

export async function signMessage(message: string) {
  const nimiq = await provider();
  const signed = await hostCall(() => nimiq.sign(message), "Nimiq Pay did not sign.");
  const signature = typeof signed.signature === "string" ? signed.signature : String(signed.signature ?? "");
  const publicKey = typeof signed.publicKey === "string" ? signed.publicKey : String(signed.publicKey ?? "");
  if (!signature || !publicKey) throw new WalletError("error", "Nimiq Pay returned an incomplete signature.");
  return { signature, publicKey };
}

export async function sendNim(options: { recipient: string; nim: number; note?: string }) {
  const recipient = normaliseNimiqAddress(options.recipient);
  if (!isValidNimiqAddress(recipient)) throw new WalletError("error", "That is not a valid Nimiq address.");
  const value = nimToLunas(options.nim);
  await assertMainnetHost();
  const nimiq = await provider();
  const note = options.note?.trim();
  const result = await hostCall<unknown>(() => note
    ? nimiq.sendBasicTransactionWithData({ recipient, value, data: note.slice(0, 64) })
    : nimiq.sendBasicTransaction({ recipient, value }), "Nimiq Pay did not return a transaction.");
  return unwrap(result, "Nimiq Pay did not return a transaction.");
}

/**
 * SayPay confirms every payment on Nimiq mainnet. A host on testnet would sign a transaction SayPay can
 * never find, leaving the invoice stuck as unpaid, so stop before sending and say why.
 * Hosts older than SDK 0.2 don't report a network; those are treated as mainnet.
 */
async function assertMainnetHost() {
  if (typeof window === "undefined") return;
  const { getHostNetwork } = await import("@nimiq/mini-app-sdk");
  if (getHostNetwork() === "testnet") {
    throw new WalletError("unsupported", "Nimiq Pay is on testnet. SayPay settles on mainnet, so switch Nimiq Pay to mainnet to pay.");
  }
}

export async function getBlockNumber() {
  const nimiq = await provider();
  const block = await hostCall(() => nimiq.getBlockNumber(), "Could not read the Nimiq block height.");
  if (typeof block !== "number") throw new WalletError("error", "Could not read the Nimiq block height.");
  return block;
}

export { detectHtlcMethods, isEscrowSupported, openEscrow, redeemWithPreimage, refundAfterTimeout, signEarlyRelease, submitEarlyRelease };
export type { HashAlgorithm };
