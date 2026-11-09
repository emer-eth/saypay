"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatNim } from "../../_lib/units";
import { api, ApiError, sessionKey } from "../../lib/api";
import { looksLikeNimiqPayHost } from "../../lib/host";
import { OpenInNimiqPay } from "../../open-in-pay";
import { listAccounts, sendNim, WalletError } from "../../lib/wallet";
import { sendUsdt, usdtReadiness } from "../../lib/evm";

type Line = { description: string; quantity: number; unitLunas: number; amountLunas: number };
type Detail = {
  id: string;
  invoiceNumber: string | null;
  creatorWallet: string;
  creatorHandle: string;
  recipientHandle: string | null;
  amountLunas: number;
  currency: string;
  note: string;
  dueAt: string | null;
  status: string;
  recipientWallet: string | null;
  paidTransactionHash: string | null;
  paidAsset: string | null;
  priceCurrency: string | null;
  priceCents: number | null;
  acceptsUsdt: boolean;
  kind: string;
  lineItems: Line[];
};
type Quote = {
  nimLunas: number;
  usdtMicro: number | null;
  payeeEvm: string | null;
  expiresAt: string | null;
  price: { currency: string; cents: number; label: string } | null;
};

const money = (currency: string, cents: number) => new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function RequestPaymentPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState("Loading this invoice…");
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<"NIM" | "USDT" | null>(null);
  const [inPay, setInPay] = useState(true);

  useEffect(() => {
    setInPay(looksLikeNimiqPayHost());
    fetch(`/api/requests/${params.id}`).then(async (response) => {
      const data = await response.json() as { request?: Detail; error?: string };
      if (!response.ok || !data.request) throw new Error(data.error ?? "Unable to load this invoice.");
      setDetail(data.request);
      if (data.request.status !== "open") {
        setMessage(`This invoice is ${data.request.status}.`);
        return;
      }
      setMessage("Pay inside Nimiq Pay. Nothing moves until you approve it there.");
      const quoted = await fetch(`/api/requests/${params.id}/quote`, { method: "POST" });
      const body = await quoted.json() as { quote?: Quote; error?: string };
      if (!quoted.ok || !body.quote) throw new Error(body.error ?? "Couldn't price this invoice right now.");
      setQuote(body.quote);
    }).catch((e) => setError(e instanceof Error ? e.message : "Unable to load this invoice."));
  }, [params.id]);

  function payerToken(address: string) {
    const token = window.localStorage.getItem(sessionKey(address));
    if (!token) throw new Error("Open SayPay, verify your ID once, then come back to pay.");
    return token;
  }

  /** The server confirms on chain; a fresh transaction can take a few seconds to show up, so keep asking. */
  async function confirm(token: string, body: Record<string, unknown>) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        return await api<{ txHash: string; confirmations: number }>(`/api/requests/${detail!.id}`, { method: "PATCH", token, body });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && /confirm|include|waiting|retry/i.test(e.message)) {
          setMessage(e.message);
          await sleep(4000);
          continue;
        }
        throw e;
      }
    }
    throw new Error("Still waiting for the network to confirm. Your payment is safe; reopen this invoice in a minute.");
  }

  async function payNim() {
    if (!detail || !quote) return;
    setPaying("NIM");
    setError(null);
    try {
      const accounts = await listAccounts();
      const payer = accounts[0].replace(/\s/g, "").toUpperCase();
      if (detail.recipientWallet && detail.recipientWallet !== payer) throw new Error("This invoice is billed to a different SayPay ID.");
      const token = payerToken(payer);
      setMessage("Approve the payment in Nimiq Pay…");
      const hint = await sendNim({ recipient: detail.creatorWallet, nim: quote.nimLunas / 100_000, note: detail.invoiceNumber ?? detail.note });
      setMessage("Sent. Checking it on the Nimiq chain…");
      const result = await confirm(token, { asset: "NIM", transactionHint: hint });
      setDetail({ ...detail, status: "paid", paidAsset: "NIM", paidTransactionHash: result.txHash });
      setMessage(`Paid and confirmed on chain (${result.confirmations} confirmations).`);
    } catch (e) {
      setError(e instanceof WalletError && e.reason === "rejected" ? "Cancelled in Nimiq Pay." : e instanceof Error ? e.message : "The payment could not be completed.");
    } finally {
      setPaying(null);
    }
  }

  async function payUsdt() {
    if (!detail || !quote?.usdtMicro || !quote.payeeEvm) return;
    setPaying("USDT");
    setError(null);
    try {
      const accounts = await listAccounts();
      const payer = accounts[0].replace(/\s/g, "").toUpperCase();
      if (detail.recipientWallet && detail.recipientWallet !== payer) throw new Error("This invoice is billed to a different SayPay ID.");
      const token = payerToken(payer);
      setMessage("Checking your USDT and Polygon gas…");
      const ready = await usdtReadiness(quote.usdtMicro);
      if (ready.problem) throw new Error(ready.problem);
      setMessage("Approve the USDT transfer in Nimiq Pay…");
      const txHash = await sendUsdt({ from: ready.from, to: quote.payeeEvm, micro: quote.usdtMicro });
      setMessage("Sent. Waiting for Polygon to confirm…");
      const result = await confirm(token, { asset: "USDT", txHash });
      setDetail({ ...detail, status: "paid", paidAsset: "USDT", paidTransactionHash: result.txHash });
      setMessage(`Paid in USDT and confirmed on Polygon (${result.confirmations} confirmations).`);
    } catch (e) {
      setError(e instanceof WalletError && e.reason === "rejected" ? "Cancelled in Nimiq Pay." : e instanceof Error ? e.message : "The payment could not be completed.");
    } finally {
      setPaying(null);
    }
  }

  const open = detail?.status === "open";
  const paid = detail?.status === "paid";
  const fiat = detail?.priceCurrency && detail.priceCents != null ? { currency: detail.priceCurrency, cents: detail.priceCents } : null;
  const lines = detail?.lineItems?.length
    ? detail.lineItems
    : detail
      ? [{ description: detail.note, quantity: 1, unitLunas: detail.amountLunas, amountLunas: detail.amountLunas }]
      : [];
  // Fiat invoices show each line's share of the fiat price; NIM is what's quoted to pay.
  const lineCents = (line: Line) => (fiat && detail ? Math.round((fiat.cents * line.amountLunas) / Math.max(1, detail.amountLunas)) : 0);

  return (
    <main className="public">
      <section className="invoice-sheet">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round"><path d="M2.5 3h11v7.5H7.2L4 13v-2.5H2.5z" /><path d="m5.6 6.8 1.6 1.5 3.2-3.1" /></svg>
          </span>
          SayPay
        </div>
        {!detail && !error && (
          <>
            <div className="skel" style={{ height: 18, width: 120 }} />
            <div className="skel" style={{ height: 44 }} />
            <div className="skel" style={{ height: 72 }} />
          </>
        )}
        {error && !detail && (
          <>
            <p className="kicker">Invoice</p>
            <h1>Can’t find this.</h1>
            <p className="lead">{error}</p>
          </>
        )}
        {detail && (
          <>
            <div className="row">
              <div className="grow">
                <p className="kicker">{detail.kind === "invoice" ? "Invoice" : "Payment request"}</p>
                <h1>{detail.invoiceNumber ?? "Invoice"}</h1>
              </div>
              {paid && <span className="stamp" aria-label="Paid">Paid</span>}
            </div>
            <div className="kv"><span>From</span><b>@{detail.creatorHandle}</b></div>
            {detail.recipientHandle && <div className="kv"><span>Bill to</span><b>@{detail.recipientHandle}</b></div>}
            {detail.dueAt && <div className="kv"><span>Due</span><b>{new Date(detail.dueAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</b></div>}
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="num">Qty</th>
                  <th className="num">{fiat ? fiat.currency : "NIM"}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={index}>
                    <td>{line.description}</td>
                    <td className="num">{line.quantity}</td>
                    <td className="num">{fiat ? money(fiat.currency, lineCents(line)) : formatNim(line.amountLunas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="kv"><span>Total</span><b>{fiat ? money(fiat.currency, fiat.cents) : `${formatNim(detail.amountLunas)} NIM`}</b></div>
            {paid && detail.paidTransactionHash && (
              <>
                <div className="kv"><span>Paid in</span><b>{detail.paidAsset ?? "NIM"}</b></div>
                <p className="mono">{detail.paidTransactionHash}</p>
              </>
            )}
            {!inPay && open && (
              <OpenInNimiqPay compact body="Pay this invoice inside Nimiq Pay. Download it for your phone if you don’t have it yet." />
            )}
            {open && (
              <div className="stack" style={{ gap: 10 }}>
                <button className="btn btn-primary btn-block" onClick={() => void payNim()} disabled={!quote || paying !== null}>
                  {paying === "NIM" ? "Paying…" : quote ? `Pay ${formatNim(quote.nimLunas)} NIM` : "Getting today’s rate…"}
                </button>
                {quote?.usdtMicro && quote.payeeEvm && (
                  <button className="btn btn-secondary btn-block" onClick={() => void payUsdt()} disabled={paying !== null}>
                    {paying === "USDT" ? "Paying…" : `Pay ${(quote.usdtMicro / 1e6).toFixed(2)} USDT · Polygon`}
                  </button>
                )}
                {quote?.price && quote.expiresAt && (
                  <p className="small">
                    {quote.price.label} at today’s rate, held until {new Date(quote.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.
                    {quote.usdtMicro ? " USDT needs a little POL for Polygon gas; NIM needs nothing extra." : ""}
                  </p>
                )}
              </div>
            )}
            <p className="small">{message}</p>
            {error && <div className="banner error" role="alert">{error}</div>}
          </>
        )}
      </section>
    </main>
  );
}
