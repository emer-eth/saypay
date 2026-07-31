"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type SplitDetail = {
  id: string;
  creatorWallet: string;
  creatorHandle: string;
  note: string;
  currency: string;
  status: string;
  participant?: { shareLunas: number; status: string };
};

export default function SplitPaymentPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<SplitDetail | null>(null);
  const [message, setMessage] = useState("Loading split invitation…");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    fetch(`/api/splits/${params.id}`).then(async (response) => {
      const data = await response.json() as { split?: SplitDetail; error?: string };
      if (!response.ok || !data.split) throw new Error(data.error ?? "Unable to load this split.");
      setDetail(data.split);
      setMessage("Open this page in Nimiq Pay to settle your share.");
    }).catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load this split."));
  }, [params.id]);

  async function payShare() {
    if (!detail) return;
    setPaying(true);
    try {
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const accounts = await nimiq.listAccounts();
      if (!Array.isArray(accounts) || !accounts[0]) throw new Error("No Nimiq Pay wallet is available.");
      const payer = accounts[0].replace(/\s/g, "").toUpperCase();
      const token = window.localStorage.getItem(`saypay-session:${payer}`);
      if (!token) throw new Error("Open SayPay, verify your ID once, then return here to settle this split.");
      const participantResponse = await fetch(`/api/splits/${detail.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!participantResponse.ok) throw new Error("Your SayPay ID is not invited to this split.");
      const participantPayload = await participantResponse.json() as { split?: SplitDetail };
      const shareLunas = participantPayload.split?.participant?.shareLunas;
      if (!shareLunas) throw new Error("Your share could not be found.");
      if (participantPayload.split?.participant?.status !== "pending") {
        throw new Error("Your share is already being processed.");
      }
      setMessage("Approve your share payment in Nimiq Pay…");
      const transaction = await nimiq.sendBasicTransaction({ recipient: detail.creatorWallet, value: shareLunas });
      if (typeof transaction !== "string") throw new Error("Nimiq Pay did not return a transaction result.");
      const response = await fetch(`/api/splits/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transactionReference: transaction }),
      });
      const result = await response.json() as { error?: string; status?: string; verified?: boolean };
      if (!response.ok) throw new Error(result.error ?? "Split payment was submitted but its status could not update.");
      setMessage(result.verified ? "Share verified on-chain and marked paid." : "Your split payment was submitted through Nimiq Pay.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The split payment could not be completed.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <main className="public-request">
      <section>
        <div className="public-brand">SayPay</div>
        {detail ? (
          <>
            <p className="eyebrow">SPLIT INVITATION</p>
            <h1>Settle your share</h1>
            <p className="request-to">Created by <strong>@{detail.creatorHandle}</strong></p>
            <div className="request-note">{detail.note}</div>
            <button className="primary" onClick={payShare} disabled={paying}>
              {paying ? "Opening Nimiq Pay…" : "Pay your share with Nimiq Pay"}
            </button>
          </>
        ) : (
          <h1>Split invitation</h1>
        )}
        <p className="public-status">{message}</p>
      </section>
    </main>
  );
}
