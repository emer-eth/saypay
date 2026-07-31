// Lightweight Nimiq JSON-RPC helpers for Workers. Used to read balances and to
// sanity-check transaction hashes before marking a request or split as paid.

import { env } from "cloudflare:workers";

// Which network SayPay reads is a deployment setting, not a code constant. Set
// NIMIQ_RPC_URL in wrangler vars to point at a testnet or self-hosted node.
// Defaults to the community mainnet RPC, which is what Nimiq Pay itself signs on.
const DEFAULT_RPC_URL = "https://rpc.nimiqwatch.com";

function rpcUrl() {
  const configured = (env as unknown as { NIMIQ_RPC_URL?: string }).NIMIQ_RPC_URL;
  return configured?.trim() || DEFAULT_RPC_URL;
}

type RpcResult<T> = { result?: T; error?: { message?: string } };

async function rpc<T>(method: string, params: unknown[] = []): Promise<T | null> {
  try {
    const response = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as RpcResult<T>;
    if (payload.error) return null;
    return payload.result ?? null;
  } catch {
    return null;
  }
}

export async function getAccountBalanceLunas(address: string) {
  const result = await rpc<{ data?: { balance?: number }; balance?: number }>("getAccountByAddress", [address]);
  if (!result) return null;
  const balance = result.data?.balance ?? result.balance;
  return typeof balance === "number" ? balance : null;
}

type TxLike = {
  hash?: string;
  transactionHash?: string;
  data?: {
    hash?: string;
    recipient?: string;
    to?: string;
    value?: number;
    amount?: number;
  };
  recipient?: string;
  to?: string;
  value?: number;
  amount?: number;
};

function pickAddress(tx: TxLike) {
  return (tx.data?.recipient ?? tx.data?.to ?? tx.recipient ?? tx.to ?? "").replace(/\s/g, "").toUpperCase();
}

function pickValue(tx: TxLike) {
  const value = tx.data?.value ?? tx.data?.amount ?? tx.value ?? tx.amount;
  return typeof value === "number" ? value : null;
}

/**
 * Best-effort confirmation that a transaction hash exists and matches the
 * expected recipient + Luna amount. When the RPC is unreachable we return
 * "unknown" so a temporary network blip does not block settlement forever;
 * callers should only hard-fail on an explicit mismatch.
 */
export async function verifyBasicPayment(options: {
  transactionHash: string;
  expectedRecipient: string;
  expectedValueLunas: number;
}): Promise<"ok" | "mismatch" | "unknown"> {
  const hash = options.transactionHash.trim();
  if (!hash || hash.length < 16) return "mismatch";

  // Common RPC method names across Nimiq watchers.
  const methods = ["getTransactionByHash", "getTransaction", "getTransactionByHashRaw"];
  let tx: TxLike | null = null;
  for (const method of methods) {
    tx = await rpc<TxLike>(method, [hash]);
    if (tx) break;
  }
  if (!tx) return "unknown";

  const recipient = pickAddress(tx);
  const value = pickValue(tx);
  const expectedRecipient = options.expectedRecipient.replace(/\s/g, "").toUpperCase();

  if (recipient && recipient !== expectedRecipient) return "mismatch";
  if (value !== null && value !== options.expectedValueLunas) return "mismatch";
  return "ok";
}
