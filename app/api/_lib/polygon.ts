// Confirms a USDT payment on Polygon before SayPay marks an invoice paid. The server reads the
// transaction receipt itself: it never trusts the browser's word that a payment happened.

export const POLYGON_CHAIN_ID = 137;
export const USDT_POLYGON = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MIN_CONFIRMATIONS = 3;

type Receipt = {
  status: string;
  blockNumber: string;
  to: string | null;
  from: string;
  logs: Array<{ address: string; topics: string[]; data: string }>;
};

export type UsdtCheck =
  | { status: "ok"; txHash: string; from: string; valueMicro: number; confirmations: number }
  | { status: "pending"; reason: string }
  | { status: "mismatch"; reason: string };

function rpcUrl(env?: unknown) {
  const configured = (env as { POLYGON_RPC_URL?: string } | undefined)?.POLYGON_RPC_URL;
  return configured || "https://polygon-bor-rpc.publicnode.com";
}

async function rpc<T>(method: string, params: unknown[], env?: unknown): Promise<T> {
  const response = await fetch(rpcUrl(env), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message || `Polygon RPC ${method} failed`);
  return payload.result as T;
}

export function isEvmAddress(value: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** True when `txHash` moved at least `minMicro` USDT to `payee` on Polygon and has settled. */
export async function verifyUsdtTransfer(options: { txHash: string; payee: string; minMicro: number; env?: unknown }): Promise<UsdtCheck> {
  const txHash = options.txHash.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return { status: "mismatch", reason: "That isn't a Polygon transaction hash." };
  const payee = options.payee.toLowerCase();
  const receipt = await rpc<Receipt | null>("eth_getTransactionReceipt", [txHash], options.env);
  if (!receipt) return { status: "pending", reason: "Polygon hasn't included this transaction yet. Retrying…" };
  if (receipt.status !== "0x1") return { status: "mismatch", reason: "This USDT transfer failed on Polygon, so nothing was paid." };
  const payeeTopic = `0x${payee.slice(2).padStart(64, "0")}`;
  const transfer = receipt.logs.find((log) =>
    log.address.toLowerCase() === USDT_POLYGON
    && log.topics[0]?.toLowerCase() === TRANSFER_TOPIC
    && log.topics[2]?.toLowerCase() === payeeTopic);
  if (!transfer) return { status: "mismatch", reason: "This transaction didn't send USDT to the invoice's address." };
  const value = BigInt(transfer.data);
  if (value < BigInt(options.minMicro)) {
    return { status: "mismatch", reason: `This transfer sent ${(Number(value) / 1e6).toFixed(2)} USDT, less than the ${(options.minMicro / 1e6).toFixed(2)} USDT due.` };
  }
  const head = BigInt(await rpc<string>("eth_blockNumber", [], options.env));
  const confirmations = Number(head - BigInt(receipt.blockNumber)) + 1;
  if (confirmations < MIN_CONFIRMATIONS) return { status: "pending", reason: "Waiting for Polygon to confirm the transfer…" };
  const from = transfer.topics[1] ? `0x${transfer.topics[1].slice(-40)}` : receipt.from;
  return { status: "ok", txHash, from, valueMicro: Number(value), confirmations };
}
