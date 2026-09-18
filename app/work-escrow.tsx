"use client";

import { FormEvent, useState } from "react";
import { formatNim, lunasToNim } from "./_lib/units";
import { api } from "./lib/api";
import { getBlockNumber, isEscrowSupported, openEscrow, sendNim } from "./lib/wallet";

export type EscrowRow = {
  id: string;
  description: string;
  amountLunas: number;
  status: string;
  creatorWallet: string;
  counterpartyWallet: string;
  creatorEscrowWallet: string;
  counterpartyEscrowWallet: string | null;
  creatorHandle: string | null;
  counterpartyHandle: string | null;
  creatorEscrowHandle: string | null;
  counterpartyEscrowHandle: string | null;
  aiVote: string | null;
  aiReason: string | null;
  htlcContractAddress: string | null;
  votes: Array<{ walletAddress: string; role: string; vote: string }>;
  evidence: Array<{ id: string; authorWallet: string; body: string }>;
};

function tone(status: string) {
  if (/paid|released|invoiced/i.test(status)) return "ok";
  if (/dispute|refund/i.test(status)) return "warn";
  return "info";
}

async function sha256HexBytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function WorkEscrow({
  session,
  escrows,
  busy,
  setBusy,
  notice,
  onChange,
}: {
  session: { token: string; address: string; handle: string };
  escrows: EscrowRow[];
  busy: boolean;
  setBusy: (value: boolean) => void;
  notice: (text: string, tone?: "ok" | "error") => void;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [counterparty, setCounterparty] = useState("");
  const [escrowHandle, setEscrowHandle] = useState("");
  const [amount, setAmount] = useState("50");
  const [terms, setTerms] = useState("");
  const [acceptEscrow, setAcceptEscrow] = useState("");
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const canLock = isEscrowSupported();
  const me = session.address.replace(/\s/g, "").toUpperCase();

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/escrows", {
        token: session.token,
        body: { counterpartyHandle: counterparty, escrowHandle, amount: Number(amount), description: terms },
      });
      setTerms("");
      setCounterparty("");
      setEscrowHandle("");
      setOpen(false);
      notice("Escrow offered. The other party names their escrow next.");
      onChange();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Could not create escrow.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function act(row: EscrowRow, action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      if (action === "fund") {
        if (!canLock) throw new Error("This Nimiq Pay build does not expose HTLC. Funds were not locked.");
        const height = await getBlockNumber();
        const timeoutBlock = height + 7 * 24 * 60 * 60;
        const preimage = crypto.getRandomValues(new Uint8Array(32));
        const hashRoot = await sha256HexBytes(preimage);
        notice("Approve the HTLC in Nimiq Pay…");
        const result = await openEscrow({
          recipient: row.counterpartyWallet,
          amount: lunasToNim(row.amountLunas),
          timeoutBlock,
          hashRoot,
          hashCount: 1,
          hashAlgorithm: "sha256",
        });
        if (!result.ok) throw new Error(result.message);
        extra = { ...extra, transactionHint: result.value, hashRoot, timeoutBlock };
      }
      if (action === "pay_direct") {
        notice("Approve the payment in Nimiq Pay…");
        extra = { ...extra, transactionHint: await sendNim({ recipient: row.counterpartyWallet, nim: lunasToNim(row.amountLunas), note: row.description }) };
      }
      const result = await api<{ invoice?: { id: string; invoiceNumber: string | null }; ai?: { error?: string } }>(`/api/escrows/${row.id}`, {
        token: session.token,
        method: "PATCH",
        body: { action, ...extra },
      });
      if (result.invoice) {
        await navigator.clipboard.writeText(`${window.location.origin}/request/${result.invoice.id}`).catch(() => undefined);
        notice(`${result.invoice.invoiceNumber ?? "Invoice"} copied.`);
      } else if (action === "vote") {
        notice("Vote recorded. NIM still only moves with a wallet transaction.");
      } else {
        notice("Escrow updated.");
      }
      onChange();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Escrow could not be updated.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <p className="kicker" style={{ margin: 0 }}>Escrow</p>
        <span className="grow" />
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen((value) => !value)}>{open ? "Close" : "New escrow"}</button>
      </div>
      <p className="small">Each party brings one escrow. If those two disagree, SayPay AI breaks the tie. It never moves NIM.</p>
      {open && (
        <form className="card stack" onSubmit={(event) => void create(event)}>
          <div>
            <label className="label">Other party @handle</label>
            <div className="field"><input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} required placeholder="maya" /></div>
          </div>
          <div>
            <label className="label">Your escrow @handle</label>
            <div className="field"><input value={escrowHandle} onChange={(e) => setEscrowHandle(e.target.value)} required placeholder="lee" /></div>
          </div>
          <div>
            <label className="label">Amount (NIM)</label>
            <div className="field"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></div>
          </div>
          <div>
            <label className="label">What this covers</label>
            <div className="field"><textarea value={terms} onChange={(e) => setTerms(e.target.value)} required /></div>
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>Offer escrow</button>
        </form>
      )}
      {escrows.length === 0 && !open ? (
        <div className="empty"><strong>No escrows</strong><p>Offer one with a client or worker. They name their own escrow to start.</p></div>
      ) : escrows.map((row) => {
        const isCreator = row.creatorWallet === me;
        const isCounter = row.counterpartyWallet === me;
        const isMyEscrow = row.creatorEscrowWallet === me || row.counterpartyEscrowWallet === me;
        return (
          <article key={row.id} className="card stack">
            <div className="row">
              <strong>{row.description}</strong>
              <span className="grow" />
              <span className={`pill ${tone(row.status)}`}>{row.status.replaceAll("_", " ")}</span>
            </div>
            <p className="small">
              {formatNim(row.amountLunas)} NIM · @{row.creatorHandle} ↔ @{row.counterpartyHandle}
              · escrows @{row.creatorEscrowHandle}{row.counterpartyEscrowHandle ? ` & @${row.counterpartyEscrowHandle}` : " (waiting)"}
            </p>
            {row.aiVote && (
              <p className="small">SayPay AI escrow: {row.aiVote}{row.aiReason ? ` — ${row.aiReason}` : ""}</p>
            )}
            {isCounter && row.status === "offered" && (
              <form className="stack" onSubmit={(event) => { event.preventDefault(); void act(row, "accept", { escrowHandle: acceptEscrow }); }}>
                <label className="label">Your escrow @handle</label>
                <div className="field"><input value={acceptEscrow} onChange={(e) => setAcceptEscrow(e.target.value)} required /></div>
                <button className="btn btn-primary" disabled={busy}>Accept and name escrow</button>
              </form>
            )}
            <div className="row" style={{ flexWrap: "wrap" }}>
              {isCreator && row.status === "accepted" && canLock && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(row, "fund")}>Lock NIM</button>}
              {isCreator && ["accepted", "release_recommended"].includes(row.status) && !canLock && (
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(row, "pay_direct")}>Pay this escrow</button>
              )}
              {isCounter && ["accepted", "release_recommended"].includes(row.status) && !canLock && (
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void act(row, "invoice_stage")}>Invoice this escrow</button>
              )}
              {(isCreator || isCounter) && ["accepted", "funded"].includes(row.status) && (
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void act(row, "dispute")}>Open dispute</button>
              )}
              {isMyEscrow && ["accepted", "funded", "disputed"].includes(row.status) && (
                <>
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(row, "vote", { vote: "release" })}>Vote release</button>
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void act(row, "vote", { vote: "refund" })}>Vote refund</button>
                </>
              )}
            </div>
            {(isCreator || isCounter) && (
              <form className="stack" onSubmit={(event) => { event.preventDefault(); void act(row, "add_evidence", { body: evidence[row.id] }); setEvidence((map) => ({ ...map, [row.id]: "" })); }}>
                <label className="label">Evidence note</label>
                <div className="field"><input value={evidence[row.id] ?? ""} onChange={(e) => setEvidence((map) => ({ ...map, [row.id]: e.target.value }))} placeholder="Delivery photos, link, what happened" /></div>
                <button className="btn btn-ghost btn-sm" disabled={busy || !(evidence[row.id] ?? "").trim()}>Add evidence</button>
              </form>
            )}
          </article>
        );
      })}
    </div>
  );
}
