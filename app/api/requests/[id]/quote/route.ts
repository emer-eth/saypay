import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { paymentRequests, profiles } from "../../../../../db/schema";
import { jsonError, jsonOk, HttpError } from "../../../_lib/http";
import { formatFiat, parsePriceCurrency, quoteFiat } from "../../../_lib/prices";

// Locks what the payer must send for an invoice. NIM-priced invoices are fixed. Fiat-priced ones
// are converted at the live rate and held for QUOTE_MINUTES, so the amount can't move between
// "Pay" and the wallet prompt; confirmation then checks the transfer against this exact quote.

const QUOTE_MINUTES = 15;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { id } = await Promise.resolve(params);
    const db = getDb();
    const [item] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, id)).limit(1);
    if (!item) throw new HttpError(404, "This SayPay request was not found.", "not_found");
    if (item.status !== "open") throw new HttpError(409, `This invoice is already ${item.status}.`, "conflict");

    const currency = parsePriceCurrency(item.priceCurrency);
    if (!currency || item.priceCents == null) {
      return jsonOk({ quote: { nimLunas: item.amountLunas, usdtMicro: null, payeeEvm: null, expiresAt: null, price: null } });
    }

    // Reuse a quote that's still fresh, so reopening the page doesn't change the amount.
    const fresh = item.quoteLunas != null && item.quoteExpiresAt && Date.parse(item.quoteExpiresAt) - Date.now() > 60_000;
    let nimLunas = item.quoteLunas ?? 0;
    let usdtMicro = item.quoteUsdtMicro ?? null;
    let expiresAt = item.quoteExpiresAt ?? "";
    if (!fresh) {
      const quote = await quoteFiat(currency, item.priceCents);
      nimLunas = quote.lunas;
      usdtMicro = item.acceptsUsdt === 1 ? quote.usdtMicro : null;
      expiresAt = new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString();
      await db.update(paymentRequests).set({ quoteLunas: nimLunas, quoteUsdtMicro: usdtMicro, quoteExpiresAt: expiresAt, updatedAt: new Date().toISOString() }).where(eq(paymentRequests.id, item.id));
    }

    let payeeEvm: string | null = null;
    if (item.acceptsUsdt === 1) {
      const [creator] = await db.select({ evmAddress: profiles.evmAddress }).from(profiles).where(eq(profiles.walletAddress, item.creatorWallet)).limit(1);
      payeeEvm = creator?.evmAddress ?? null;
    }
    return jsonOk({
      quote: {
        nimLunas,
        usdtMicro: payeeEvm ? usdtMicro : null,
        payeeEvm,
        expiresAt,
        price: { currency, cents: item.priceCents, label: formatFiat(currency, item.priceCents) },
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
