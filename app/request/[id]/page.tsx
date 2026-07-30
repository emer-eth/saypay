"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type RequestDetail = { id: string; creatorWallet: string; creatorHandle: string; amountLunas: number; currency: string; note: string; dueAt: string | null; status: string; recipientWallet: string | null; kind: string };

export default function RequestPaymentPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [message, setMessage] = useState("Loading payment request…");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    fetch(`/api/requests/${params.id}`).then(async (response) => {
      const data = await response.json() as { request?: RequestDetail; error?: string };
      if (!response.ok || !data.request) throw new Error(data.error ?? "Unable to load this request.");
      setDetail(data.request);
      setMessage(data.request.status === "open" ? "Open this page in Nimiq Pay to pay securely." : `This request is ${data.request.status}.`);
    }).catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load this request."));
  }, [params.id]);

  async function payRequest() {
    if (!detail) return;
    setPaying(true);
    try {
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const accounts = await nimiq.listAccounts();
      if (!accounts[0]) throw new Error("No Nimiq Pay wallet is available.");
      const payer = accounts[0].replace(/\s/g, "").toUpperCase();
      if (detail.recipientWallet !== payer) throw new Error("This invoice is assigned to a different SayPay ID.");
      const transaction = await nimiq.sendBasicTransactionWithData({ recipient: detail.creatorWallet, value: detail.amountLunas, data: `SayPay:${detail.id}` });
      if (typeof transaction !== "string") throw new Error("Nimiq Pay did not return a transaction result.");
      const token = window.localStorage.getItem(`saypay-session:${payer}`);
      if (!token) throw new Error("Open SayPay, verify your ID once, then return here to pay.");
      const response = await fetch(`/api/requests/${detail.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ transactionReference: transaction }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Payment was submitted but SayPay could not update its status.");
      setDetail({ ...detail, status: "submitted" });
      setMessage("Payment submitted through Nimiq Pay. The invoice status is updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The payment could not be completed.");
    } finally {
      setPaying(false);
    }
  }

  return <main className="public-request"><section><div className="public-brand">SayPay</div>{detail ? <><p className="eyebrow">{detail.kind === "invoice" ? "INVOICE" : "PAYMENT REQUEST"}</p><h1>{detail.amountLunas / 100_000} {detail.currency}</h1><p className="request-to">Requested by <strong>@{detail.creatorHandle}</strong></p><div className="request-note">{detail.note}</div>{detail.dueAt && <p className="request-due">Due {new Date(detail.dueAt).toLocaleDateString()}</p>}<button className="primary" onClick={payRequest} disabled={paying || detail.status !== "open"}>{paying ? "Opening Nimiq Pay…" : detail.status === "open" ? "Pay securely with Nimiq Pay" : "Payment submitted"}</button></> : <h1>Payment request</h1>}<p className="public-status">{message}</p></section></main>;
}
