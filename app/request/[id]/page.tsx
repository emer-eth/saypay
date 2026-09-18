"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatNim } from "../../_lib/units";
import { api, sessionKey } from "../../lib/api";
import { looksLikeNimiqPayHost } from "../../lib/host";
import { OpenInNimiqPay } from "../../open-in-pay";
import { listAccounts, sendNim, WalletError } from "../../lib/wallet";

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
  kind: string;
  lineItems: Line[];
};

export default function RequestPaymentPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState("Loading this invoice…");
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [inPay, setInPay] = useState(true);

  useEffect(() => {
    setInPay(looksLikeNimiqPayHost());
    fetch(`/api/requests/${params.id}`).then(async (response) => {
      const data = await response.json() as { request?: Detail; error?: string };
      if (!response.ok || !data.request) throw new Error(data.error ?? "Unable to load this invoice.");
      setDetail(data.request);
      setMessage(data.request.status === "open" ? "Open this page in Nimiq Pay to pay." : `This invoice is ${data.request.status}.`);
    }).catch((e) => setError(e instanceof Error ? e.message : "Unable to load this invoice."));
  }, [params.id]);

  async function payRequest() {
    if (!detail) return;
    setPaying(true);
    setError(null);
    try {
      const accounts = await listAccounts();
      const payer = accounts[0].replace(/\s/g, "").toUpperCase();
      if (detail.recipientWallet && detail.recipientWallet !== payer) {
        throw new Error("This invoice is assigned to a different SayPay ID.");
      }
      const token = window.localStorage.getItem(sessionKey(payer));
      if (!token) throw new Error("Open SayPay, verify your ID once, then return here to pay.");
      setMessage("Approve the payment in Nimiq Pay…");
      const hint = await sendNim({ recipient: detail.creatorWallet, nim: detail.amountLunas / 100_000, note: detail.note });
      const result = await api<{ txHash: string; confirmations: number }>(`/api/requests/${detail.id}`, {
        method: "PATCH",
        token,
        body: { transactionHint: hint },
      });
      setDetail({ ...detail, status: "paid", paidTransactionHash: result.txHash });
      setMessage(`Paid and confirmed on-chain (${result.confirmations} confirmations).`);
    } catch (e) {
      setError(e instanceof WalletError && e.reason === "rejected" ? "Cancelled in Nimiq Pay." : e instanceof Error ? e.message : "The payment could not be completed.");
    } finally {
      setPaying(false);
    }
  }

  const open = detail?.status === "open";
  const paid = detail?.status === "paid";
  const lines = detail?.lineItems?.length
    ? detail.lineItems
    : detail
      ? [{ description: detail.note, quantity: 1, unitLunas: detail.amountLunas, amountLunas: detail.amountLunas }]
      : [];

  return (
    <main className="public">
      <section className="invoice-sheet">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8.5 6.5 12 13 4" /></svg>
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
              <div>
                <p className="kicker">{detail.kind === "invoice" ? "Invoice" : "Payment request"}</p>
                <h1>{detail.invoiceNumber ?? "Invoice"}</h1>
              </div>
              {paid && <span className="stamp" aria-label="Paid">Paid</span>}
            </div>
            <div className="kv"><span>From</span><b>@{detail.creatorHandle}</b></div>
            {detail.recipientHandle && <div className="kv"><span>Bill to</span><b>@{detail.recipientHandle}</b></div>}
            {detail.dueAt && (
              <div className="kv"><span>Due</span><b>{new Date(detail.dueAt).toLocaleDateString()}</b></div>
            )}
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="num">Qty</th>
                  <th className="num">NIM</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={index}>
                    <td>{line.description}</td>
                    <td className="num">{line.quantity}</td>
                    <td className="num">{formatNim(line.unitLunas)}</td>
                    <td className="num">{formatNim(line.amountLunas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="kv"><span>Total</span><b>{formatNim(detail.amountLunas)} {detail.currency}</b></div>
            {paid && detail.paidTransactionHash && (
              <p className="mono">{detail.paidTransactionHash}</p>
            )}
            {!inPay && open && (
              <OpenInNimiqPay compact body="Pay this invoice inside Nimiq Pay. Download it for your phone if you do not have it yet." />
            )}
            <button className="btn btn-primary btn-block" onClick={() => void payRequest()} disabled={paying || !open}>
              {paying ? "Opening Nimiq Pay…" : open ? "Pay with Nimiq Pay" : `Already ${detail.status}`}
            </button>
            <p className="small">{message}</p>
            {error && <div className="banner error" role="alert">{error}</div>}
          </>
        )}
      </section>
    </main>
  );
}
