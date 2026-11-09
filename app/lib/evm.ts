// USDT on Polygon through the EVM wallet Nimiq Pay injects as window.ethereum.
// Mini App transfers pay normal Polygon gas (POL), unlike Nimiq Pay's own gasless USDT sends,
// so every check that could make a payment fail happens here, before the wallet prompt.

import { WalletError } from "./wallet";

export const POLYGON = "0x89";
export const USDT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
/** Enough POL for an ERC-20 transfer with headroom: about 0.01 POL. */
const MIN_POL_WEI = BigInt("10000000000000000");

type Eip1193 = { request(args: { method: string; params?: unknown }): Promise<unknown> };

function provider(): Eip1193 {
  const eth = typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new WalletError("not_in_host", "USDT needs Nimiq Pay's wallet. Open this page inside Nimiq Pay.");
  return eth;
}

async function call<T>(method: string, params?: unknown): Promise<T> {
  try {
    return await provider().request({ method, params }) as T;
  } catch (error) {
    if (error instanceof WalletError) throw error;
    const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
    const code = (error as { code?: number })?.code;
    throw new WalletError(code === 4001 || /reject|denied|cancel/i.test(message) ? "rejected" : "error", message || "The wallet didn't respond.");
  }
}

const pad = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");

export async function evmAccount() {
  const accounts = await call<string[]>("eth_requestAccounts");
  if (!accounts?.[0]) throw new WalletError("error", "Nimiq Pay didn't share a Polygon address.");
  return accounts[0];
}

async function onPolygon() {
  const chain = await call<string>("eth_chainId").catch(() => "");
  if (String(chain).toLowerCase() !== POLYGON) await call("wallet_switchEthereumChain", [{ chainId: POLYGON }]);
}

async function usdtBalanceMicro(address: string) {
  const data = `0x70a08231${pad(address)}`; // balanceOf(address)
  const raw = await call<string>("eth_call", [{ to: USDT, data }, "latest"]);
  return BigInt(raw || "0x0");
}

/** Why this wallet can't pay `micro` USDT right now, or null if it can. */
export async function usdtReadiness(micro: number) {
  const from = await evmAccount();
  await onPolygon();
  const [usdt, pol] = await Promise.all([
    usdtBalanceMicro(from),
    call<string>("eth_getBalance", [from, "latest"]).then((v) => BigInt(v || "0x0")),
  ]);
  if (usdt < BigInt(micro)) {
    return { from, problem: `You have ${(Number(usdt) / 1e6).toFixed(2)} USDT on Polygon; this invoice needs ${(micro / 1e6).toFixed(2)}. Pay in NIM instead, or top up USDT.` };
  }
  if (pol < MIN_POL_WEI) {
    return { from, problem: "Paying USDT from a Mini App needs a little POL for Polygon gas (about 0.01), and this wallet has none. Pay in NIM instead; it needs no extra token." };
  }
  return { from, problem: null as string | null };
}

/** Sends `micro` USDT to `to` on Polygon and returns the transaction hash. */
export async function sendUsdt(options: { from: string; to: string; micro: number }) {
  await onPolygon();
  const data = `0xa9059cbb${pad(options.to)}${pad(BigInt(options.micro).toString(16))}`; // transfer(address,uint256)
  const hash = await call<string>("eth_sendTransaction", [{ from: options.from, to: USDT, data, value: "0x0" }]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new WalletError("error", "The wallet didn't return a Polygon transaction.");
  return hash;
}
