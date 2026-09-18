"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatNim } from "../../_lib/units";
import { api, sessionKey } from "../../lib/api";
import { looksLikeNimiqPayHost } from "../../lib/host";
import { OpenInNimiqPay } from "../../open-in-pay";
import { listAccounts, sendNim, WalletError } from "../../lib/wallet";

type Detail = {
  id: string;
  creatorWallet: string;
  creatorHandle: string;
  note: string;
  currency: string;
  status: string;
  participant?: { shareLunas: number; status: string } | null;
};

export default function SplitPaymentPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState("Loading split invitation…");
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [inPay, setInPay] = useState(true);

  useEffect(() => {
    setInPay(looksLikeNimiqPayHost());
    fetch(`/api/splits/${params.id}`).then(async (response) => {
      const data = await response.json() as { split?: Detail; error?: string };
      if (!response.ok || !data.split) throw new Error(data.error ?? "Unable to load this split.");
      setDetail(data.split);
      setMessage("Open this page in Nimiq Pay to settle your share.");
    }).catch((e) => setError(e instanceof Error ? e.message : "Unable to load this split."));
  }, [params.id]);

  async function payShare() {
    if (!detail) return;
    setPaying(true);
    setError(null);
    try {
      const accounts = await listAccounts();
      const payer = accounts[0].replace(/\s/g, "").toUpperCase();
      const token = window.localStorage.getItem(sessionKey(payer));
      if (!token) throw new Error("Open SayPay, verify your ID once, then return here to settle this split.");
      const participantPayload = await api<{ split: Detail }>(`/api/splits/${detail.id}`, { token });
      const shareLunas = participantPayload.split.participant?.shareLunas;
      if (!shareLunas) throw new Error("Your share could not be found.");
      if (participantPayload.split.participant?.status !== "pending") throw new Error("Your share is already being processed.");
      setMessage("Approve your share payment in Nimiq Pay…");
      const hint = await sendNim({ recipient: detail.creatorWallet, nim: shareLunas / 100_000, note: detail.note });
      const result = await api<{ txHash: string; confirmations: number }>(`/api/splits/${detail.id}`, {
        method: "PATCH",
        token,
        body: { transactionHint: hint },
      });
      setMessage(`Share confirmed on-chain (${result.confirmations} confirmations).`);
    } catch (e) {
      setError(e instanceof WalletError && e.reason === "rejected" ? "Cancelled in Nimiq Pay." : e instanceof Error ? e.message : "The split payment could not be completed.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <main className="public">
      <section>
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8.5 6.5 12 13 4" /></svg>
          </span>
          SayPay
        </div>
        {!detail && !error && (
          <>
            <div className="skel" style={{ height: 18, width: 140 }} />
            <div className="skel" style={{ height: 40 }} />
            <div className="skel" style={{ height: 72 }} />
          </>
        )}
        {error && !detail && (
          <>
            <p className="kicker">Split</p>
            <h1>Can’t find this.</h1>
            <p className="lead">{error}</p>
          </>
        )}
        {detail && (
          <>
            <p className="kicker">Split invitation</p>
            <h1>Settle your share</h1>
            <p className="muted">Created by <strong>@{detail.creatorHandle}</strong></p>
            <div className="said"><span>For</span>{detail.note}</div>
            {detail.participant && (
              <>
                <div className="amt-bar" aria-hidden><span style={{ width: "100%" }} /></div>
                <p className="small">{formatNim(detail.participant.shareLunas)} NIM · {detail.participant.status}</p>
              </>
            )}
            {!inPay && (
              <OpenInNimiqPay compact body="Settle this split inside Nimiq Pay. Download it for your phone if you do not have it yet." />
            )}
            <button className="btn btn-primary btn-block" onClick={() => void payShare()} disabled={paying}>
              {paying ? "Opening Nimiq Pay…" : "Pay your share with Nimiq Pay"}
            </button>
            <p className="small">{message}</p>
            {error && <div className="banner error" role="alert">{error}</div>}
          </>
        )}
      </section>
    </main>
  );
}
