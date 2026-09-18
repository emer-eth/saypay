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
  const text = (value instanceof Error ? value.message : isErrorResponse(value) ? value.error.message : String(value)).toLowerCase();
  return /reject|denied|cancel|abort/.test(text);
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
    const accounts = await nimiq.listAccounts();
    if (isErrorResponse(accounts)) throw new WalletError(looksRejected(accounts) ? "rejected" : "error", accounts.error.message);
    if (!Array.isArray(accounts) || !accounts[0]) throw new WalletError("error", "No Nimiq account is available.");
    return accounts.map((address) => formatNimiqAddress(address));
  } catch (error) {
    if (error instanceof WalletError) throw error;
    throw new WalletError(looksRejected(error) ? "rejected" : "not_in_host", error instanceof Error ? error.message : "Open SayPay inside Nimiq Pay.");
  }
}

export async function signMessage(message: string) {
  const nimiq = await provider();
  const signed = await nimiq.sign(message);
  if (isErrorResponse(signed)) throw new WalletError(looksRejected(signed) ? "rejected" : "error", signed.error.message);
  const signature = typeof signed.signature === "string" ? signed.signature : String(signed.signature ?? "");
  const publicKey = typeof signed.publicKey === "string" ? signed.publicKey : String(signed.publicKey ?? "");
  if (!signature || !publicKey) throw new WalletError("error", "Nimiq Pay returned an incomplete signature.");
  return { signature, publicKey };
}

export async function sendNim(options: { recipient: string; nim: number; note?: string }) {
  const recipient = normaliseNimiqAddress(options.recipient);
  if (!isValidNimiqAddress(recipient)) throw new WalletError("error", "That is not a valid Nimiq address.");
  const value = nimToLunas(options.nim);
  const nimiq = await provider();
  const note = options.note?.trim();
  const result = note
    ? await nimiq.sendBasicTransactionWithData({ recipient, value, data: note.slice(0, 64) })
    : await nimiq.sendBasicTransaction({ recipient, value });
  return unwrap(result, "Nimiq Pay did not return a transaction.");
}

export async function getBlockNumber() {
  const nimiq = await provider();
  const block = await nimiq.getBlockNumber();
  if (typeof block !== "number") throw new WalletError("error", "Could not read the Nimiq block height.");
  return block;
}

export { detectHtlcMethods, isEscrowSupported, openEscrow, redeemWithPreimage, refundAfterTimeout, signEarlyRelease, submitEarlyRelease };
export type { HashAlgorithm };
