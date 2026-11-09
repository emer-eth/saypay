import { HttpError } from "./http";

// Live rates for invoices priced in a fiat currency. One CoinGecko call gives NIM and USDT in the
// invoice currency; results are cached briefly so a burst of quotes doesn't hammer the API.

export const PRICE_CURRENCIES = ["USD", "EUR"] as const;
export type PriceCurrency = (typeof PRICE_CURRENCIES)[number];

export function parsePriceCurrency(value: unknown): PriceCurrency | null {
  if (value == null || value === "" || value === "NIM") return null;
  const upper = String(value).toUpperCase();
  if ((PRICE_CURRENCIES as readonly string[]).includes(upper)) return upper as PriceCurrency;
  throw new HttpError(400, `Price invoices in NIM, ${PRICE_CURRENCIES.join(" or ")}.`, "invalid_currency");
}

type Rates = { nim: number; usdt: number; at: number };
const cache = new Map<string, Rates>();
const TTL_MS = 60_000;

/** Price of 1 NIM and 1 USDT in the given currency. */
export async function ratesIn(currency: PriceCurrency): Promise<Rates> {
  const hit = cache.get(currency);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const vs = currency.toLowerCase();
  let payload: Record<string, Record<string, number>> = {};
  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2,tether&vs_currencies=${vs}`, {
      headers: { accept: "application/json" },
    });
    if (response.ok) payload = await response.json() as typeof payload;
  } catch {
    // handled below
  }
  const nim = payload["nimiq-2"]?.[vs];
  const usdt = payload.tether?.[vs];
  if (!(typeof nim === "number" && nim > 0 && typeof usdt === "number" && usdt > 0)) {
    if (hit) return hit; // a slightly old rate beats no invoice
    throw new HttpError(503, "Couldn't fetch today's NIM rate. Try again in a minute.", "rate_unavailable");
  }
  const rates = { nim, usdt, at: Date.now() };
  cache.set(currency, rates);
  return rates;
}

/** What a fiat price costs right now, in lunas (1 NIM = 100,000) and micro-USDT (1 USDT = 1,000,000). */
export async function quoteFiat(currency: PriceCurrency, cents: number) {
  const rates = await ratesIn(currency);
  const fiat = cents / 100;
  // Round up so the payee never receives less than the price.
  const lunas = Math.ceil((fiat / rates.nim) * 100_000);
  const usdtMicro = Math.ceil((fiat / rates.usdt) * 100) * 10_000; // whole cents of USDT
  return { lunas, usdtMicro, nimRate: rates.nim, usdtRate: rates.usdt };
}

export function formatFiat(currency: string, cents: number) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
}
