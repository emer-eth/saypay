import { env } from "cloudflare:workers";
import { normaliseNimiqAddress } from "../../_lib/units";
import { log } from "./log";

const DEFAULT_RPC_URL = "https://rpc.nimiqwatch.com";
const RPC_ATTEMPTS = 3;

function rpcUrl() {
  const configured = (env as unknown as { NIMIQ_RPC_URL?: string }).NIMIQ_RPC_URL;
  return configured?.trim() || DEFAULT_RPC_URL;
}

type RpcEnvelope<T> = { result?: { data?: T } | T; error?: { message?: string } | string };

function unwrap<T>(payload: RpcEnvelope<T>): T | null {
  if (payload.error) return null;
  const result = payload.result;
  if (result == null) return null;
  if (typeof result === "object" && result !== null && "data" in result && (result as { data?: T }).data !== undefined) {
    return (result as { data: T }).data;
  }
  return result as T;
}

async function rpc<T>(method: string, params: unknown[] = []): Promise<T | null> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(rpcUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const payload = await response.json() as RpcEnvelope<T>;
      const value = unwrap<T>(payload);
      if (value !== null) return value;
      lastError = typeof payload.error === "string" ? payload.error : payload.error?.message ?? "empty result";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  log("warn", "nimiq_rpc_failed", { method, lastError });
  return null;
}

export type ChainTx = {
  hash: string;
  from: string;
  to: string;
  value: number;
  fee: number;
  confirmations?: number;
  blockNumber?: number;
  timestamp?: number;
  executionResult?: boolean;
};

export async function getBlockNumber() {
  const result = await rpc<number>("getBlockNumber", []);
  return typeof result === "number" ? result : null;
}

export async function getAccountBalanceLunas(address: string) {
  const result = await rpc<{ balance?: number }>("getAccountByAddress", [address]);
  return typeof result?.balance === "number" ? result.balance : null;
}

export async function getAccount(address: string) {
  return rpc<{ address?: string; balance?: number; type?: string }>("getAccountByAddress", [address]);
}

export async function getTransactionByHash(hash: string): Promise<ChainTx | null> {
  const tx = await rpc<ChainTx>("getTransactionByHash", [hash]);
  if (!tx || typeof tx.hash !== "string") return null;
  return tx;
}

export async function getRecentTransactions(address: string, max = 25): Promise<ChainTx[]> {
  const rows = await rpc<ChainTx[]>("getTransactionsByAddress", [address, max, null]);
  return Array.isArray(rows) ? rows : [];
}

export type PaymentCheck = {
  status: "ok" | "mismatch" | "unknown";
  tx?: ChainTx;
  reason?: string;
};

/**
 * Confirm a NIM payment on-chain. Never treats an RPC outage as success.
 * `hint` may be a 64-char hash or a serialized transaction the wallet returned.
 */
export async function verifyOutgoing(options: {
  hint?: string;
  expectedFrom: string;
  expectedValueLunas: number;
}): Promise<PaymentCheck> {
  const from = normaliseNimiqAddress(options.expectedFrom);
  const value = options.expectedValueLunas;
  if (!from || !Number.isInteger(value) || value <= 0) {
    return { status: "mismatch", reason: "Invalid payment parameters." };
  }
  const hint = options.hint?.trim() ?? "";
  const hash = hint.replace(/^0x/i, "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hash)) {
    const tx = await getTransactionByHash(hash);
    if (!tx) return { status: "unknown", reason: "Transaction not found on the Nimiq node yet." };
    const txFrom = normaliseNimiqAddress(tx.from ?? "");
    if (txFrom && txFrom !== from) return { status: "mismatch", reason: "Sender does not match the signed-in wallet.", tx };
    if (typeof tx.value === "number" && tx.value !== value) return { status: "mismatch", reason: "Amount does not match.", tx };
    if (tx.executionResult === false) return { status: "mismatch", reason: "Transaction failed on-chain.", tx };
    return { status: "ok", tx };
  }
  const recent = await getRecentTransactions(from, 40);
  if (recent.length === 0) return { status: "unknown", reason: "Could not read recent transactions from the node." };
  const match = recent.find((tx) => {
    const txFrom = normaliseNimiqAddress(tx.from ?? "");
    return (!txFrom || txFrom === from) && tx.value === value && tx.executionResult !== false;
  });
  if (match) return { status: "ok", tx: match };
  return { status: "unknown", reason: "No matching outgoing transaction found yet." };
}

export async function verifyPayment(options: {
  hint?: string;
  expectedFrom: string;
  expectedTo: string;
  expectedValueLunas: number;
}): Promise<PaymentCheck> {
  const from = normaliseNimiqAddress(options.expectedFrom);
  const to = normaliseNimiqAddress(options.expectedTo);
  const value = options.expectedValueLunas;
  if (!from || !to || !Number.isInteger(value) || value <= 0) {
    return { status: "mismatch", reason: "Invalid payment parameters." };
  }

  const hint = options.hint?.trim() ?? "";
  const hash = hint.replace(/^0x/i, "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hash)) {
    const tx = await getTransactionByHash(hash);
    if (!tx) return { status: "unknown", reason: "Transaction not found on the Nimiq node yet." };
    return matchTx(tx, from, to, value);
  }

  const recent = await getRecentTransactions(from, 40);
  if (recent.length === 0) return { status: "unknown", reason: "Could not read recent transactions from the node." };
  const match = recent.find((tx) => {
    const check = matchTx(tx, from, to, value);
    return check.status === "ok";
  });
  if (match) return { status: "ok", tx: match };
  return { status: "unknown", reason: "No matching transaction found yet. Wait for confirmation and retry." };
}

function matchTx(tx: ChainTx, from: string, to: string, value: number): PaymentCheck {
  const txFrom = normaliseNimiqAddress(tx.from ?? "");
  const txTo = normaliseNimiqAddress(tx.to ?? "");
  if (txFrom && txFrom !== from) return { status: "mismatch", reason: "Sender does not match the signed-in wallet.", tx };
  if (txTo && txTo !== to) return { status: "mismatch", reason: "Recipient does not match.", tx };
  if (typeof tx.value === "number" && tx.value !== value) return { status: "mismatch", reason: "Amount does not match.", tx };
  if (tx.executionResult === false) return { status: "mismatch", reason: "Transaction failed on-chain.", tx };
  return { status: "ok", tx };
}

export async function pingRpc() {
  const block = await getBlockNumber();
  return { ok: block !== null, block, url: rpcUrl() };
}
