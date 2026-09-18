"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { formatNim } from "./_lib/units";
import { Fold } from "./fold";
import { api } from "./lib/api";
import { WorkEscrow, type EscrowRow } from "./work-escrow";
import { WorkJobs, type JobRow } from "./work-jobs";

export type AgentRecord = {
  id: string;
  section: string;
  kind: string;
  title: string;
  body: string;
  dueAt?: string | null;
  status?: string;
  hasImage: boolean;
  createdAt: string;
};

export type LineItemView = { id?: string; description: string; quantity: number; unitLunas: number; amountLunas: number };
export type InvoiceRow = {
  id: string;
  kind: string;
  invoiceNumber: string | null;
  amountLunas: number;
  note: string;
  dueAt: string | null;
  status: string;
  creatorWallet: string;
  recipientWallet: string | null;
  creatorHandle: string;
  recipientHandle: string | null;
  paidTransactionHash: string | null;
  lineItems: LineItemView[];
};
export type TimeEntry = {
  id: string;
  clientHandle: string;
  clientWallet: string;
  description: string;
  rateLunasPerHour: number;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  status: string;
  invoiceId: string | null;
};
export type WorkLedger = {
  owedLunas: number;
  oweLunas: number;
  dueTodayLunas: number;
  overdueLunas: number;
  dueToday: InvoiceRow[];
  overdue: InvoiceRow[];
  receivable: InvoiceRow[];
  payable: InvoiceRow[];
  splitsOwed: Array<{ id: string; splitId: string; shareLunas: number; note: string; status: string }>;
  timer: TimeEntry | null;
  unbilled: TimeEntry[];
};

type LineDraft = { description: string; quantity: string; unit: string };

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function tone(status: string) {
  if (/paid|confirmed|released|completed|invoiced/i.test(status)) return "ok";
  if (/overdue|fail|cancel|dispute|refund/i.test(status)) return "warn";
  return "info";
}

function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const ms = Math.max(0, now - startedAt);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return <span className="timer-face">{h}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</span>;
}

function dueLabel(dueAt: string | null) {
  if (!dueAt) return "No due date";
  return `Due ${new Date(dueAt).toLocaleDateString()}`;
}

export function WorkPanel({
  session,
  ledger,
  balance,
  ready,
  loadError,
  busy,
  onRetry,
  onTalk,
  onPayInvoice,
  onCopy,
  notice,
  refresh,
  escrows,
  jobs,
  setBusy,
}: {
  session: { token: string; handle: string; address: string };
  ledger: WorkLedger | null;
  balance: { nim: number; usd: number | null; lunas: number } | null;
  ready: boolean;
  loadError: string | null;
  busy: boolean;
  onRetry: () => void;
  onTalk: () => void;
  onPayInvoice: (row: InvoiceRow) => void;
  onCopy: (text: string) => Promise<void> | void;
  notice: (text: string, tone?: "ok" | "error") => void;
  refresh: () => Promise<void>;
  escrows: EscrowRow[];
  jobs: JobRow[];
  setBusy: (value: boolean) => void;
}) {
  const [showInvoice, setShowInvoice] = useState(false);
  const [client, setClient] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ description: "", quantity: "1", unit: "" }]);
  const [timerClient, setTimerClient] = useState("");
  const [timerRate, setTimerRate] = useState("40");
  const [timerNote, setTimerNote] = useState("");

  async function createInvoice(event: FormEvent) {
    event.preventDefault();
    const lineItems = lines
      .map((line) => ({
        description: line.description.trim(),
        quantity: Number(line.quantity),
        unitNim: Number(line.unit),
      }))
      .filter((line) => line.description && line.unitNim > 0 && line.quantity > 0);
    if (!lineItems.length) {
      notice("Add at least one line with a description, quantity, and NIM rate.", "error");
      return;
    }
    try {
      const created = await api<{ request: { id: string; invoiceNumber: string | null } }>("/api/requests", {
        token: session.token,
        body: {
          recipientHandle: client,
          note: note.trim() || lineItems[0].description,
          dueAt: due || undefined,
          kind: "invoice",
          lineItems,
        },
      });
      const link = `${window.location.origin}/request/${created.request.id}`;
      await onCopy(link);
      notice(`${created.request.invoiceNumber ?? "Invoice"} ready. Link copied.`);
      setShowInvoice(false);
      setClient("");
      setDue("");
      setNote("");
      setLines([{ description: "", quantity: "1", unit: "" }]);
      await refresh();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Could not create the invoice.", "error");
    }
  }

  async function timerAction(action: "start" | "stop" | "invoice", id?: string) {
    try {
      const result = await api<{ invoice?: { id: string; invoiceNumber: string | null } }>("/api/time", {
        token: session.token,
        body: action === "start"
          ? { action, clientHandle: timerClient, rateNimPerHour: Number(timerRate), description: timerNote }
          : { action, id },
      });
      if (action === "start") {
        setTimerClient("");
        setTimerNote("");
        notice("Timer running.");
      } else if (action === "stop") {
        notice("Timer stopped.");
      } else if (result.invoice) {
        const link = `${window.location.origin}/request/${result.invoice.id}`;
        await onCopy(link);
        notice(`${result.invoice.invoiceNumber ?? "Invoice"} from time. Link copied.`);
      }
      await refresh();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Timer could not be updated.", "error");
    }
  }

  const stats = [
    { label: "You are owed", value: ledger?.owedLunas ?? 0, warn: false },
    { label: "You owe", value: ledger?.oweLunas ?? 0, warn: false },
    { label: "Due today", value: ledger?.dueTodayLunas ?? 0, warn: false },
    { label: "Overdue", value: ledger?.overdueLunas ?? 0, warn: true },
  ];

  return (
    <section className="screen wide">
      <div className="page-head">
        <div>
          <p className="kicker">Work</p>
          <h1>Get paid for work.</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowInvoice((open) => !open)}>
          {showInvoice ? "Close" : "New invoice"}
        </button>
      </div>
      <p className="muted">Active jobs, timers, invoices, and escrow. You is for tasks and receipts Ask files.</p>
      {loadError && <div className="banner error" role="alert">{loadError} <button className="btn btn-ghost btn-sm" onClick={onRetry}>Retry</button></div>}
      {!ready && !loadError ? (
        <div className="stack" aria-hidden>
          <div className="skel" style={{ height: 96 }} />
          <div className="skel" style={{ height: 120 }} />
        </div>
      ) : (
        <>
          <article className="balance">
            <p className="kicker">Wallet</p>
            {balance ? (
              <>
                <div className="figure">{formatNim(balance.lunas)} <span>NIM</span></div>
                <p className="small">
                  Live from the Nimiq node
                  {balance.usd != null
                    ? ` · ≈ ${new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(balance.usd)}`
                    : ""}
                </p>
              </>
            ) : (
              <div className="skel" style={{ height: 48 }} />
            )}
          </article>
          <Fold title="Overview" defaultOpen>
            <div className="stats">
              {stats.map((stat) => (
                <div key={stat.label} className={`stat${stat.warn && stat.value > 0 ? " warn" : ""}`}>
                  <p className="kicker">{stat.label}</p>
                  <div className="figure">{formatNim(stat.value)} <span>NIM</span></div>
                </div>
              ))}
            </div>
          </Fold>

          <Fold title="Time" count={(ledger?.timer ? 1 : 0) + (ledger?.unbilled.length ?? 0)} defaultOpen={Boolean(ledger?.timer)}>
          {ledger?.timer && (
            <article className="card stack">
              <div className="row">
                <p className="kicker" style={{ margin: 0 }}>Running</p>
                <span className="grow" />
                <span className="pill info">Timer</span>
              </div>
              <Elapsed startedAt={ledger.timer.startedAt} />
              <p className="small">@{ledger.timer.clientHandle} · {formatNim(ledger.timer.rateLunasPerHour)} NIM/h{ledger.timer.description ? ` · ${ledger.timer.description}` : ""}</p>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn btn-secondary" disabled={busy} onClick={() => void timerAction("stop", ledger.timer!.id)}>Stop</button>
                <button className="btn btn-primary" disabled={busy} onClick={() => void timerAction("invoice", ledger.timer!.id)}>Invoice time</button>
              </div>
            </article>
          )}

          {!ledger?.timer && (
            <form className="card stack" onSubmit={(event) => { event.preventDefault(); void timerAction("start"); }}>
              <p className="kicker">Track time</p>
              <div>
                <label className="label" htmlFor="tclient">Client @handle</label>
                <div className="field"><input id="tclient" value={timerClient} onChange={(e) => setTimerClient(e.target.value)} placeholder="maya" required /></div>
              </div>
              <div>
                <label className="label" htmlFor="trate">NIM / hour</label>
                <div className="field"><input id="trate" value={timerRate} onChange={(e) => setTimerRate(e.target.value)} inputMode="decimal" required /></div>
              </div>
              <div>
                <label className="label" htmlFor="tnote">What are you working on</label>
                <div className="field"><input id="tnote" value={timerNote} onChange={(e) => setTimerNote(e.target.value)} placeholder="Landing page" /></div>
              </div>
              <button className="btn btn-primary btn-block" disabled={busy || !timerClient.trim()}>Start timer</button>
            </form>
          )}
          {!!ledger?.unbilled.length && (
            <div className="stack">
              {ledger.unbilled.map((row) => (
                <article key={row.id} className="item">
                  <div className="grow">
                    <strong>@{row.clientHandle}</strong>
                    <p className="small">{row.description || "Time"} · {row.durationMs ? `${(row.durationMs / 3_600_000).toFixed(2)}h` : "stopped"}</p>
                  </div>
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void timerAction("invoice", row.id)}>Invoice</button>
                </article>
              ))}
            </div>
          )}
          </Fold>

          <Fold title="Jobs" count={jobs.length} defaultOpen={jobs.length > 0}>
            <WorkJobs session={session} jobs={jobs} busy={busy} setBusy={setBusy} notice={notice} onChange={() => void refresh()} />
          </Fold>

          <Fold title="Invoices" count={(ledger?.receivable.length ?? 0) + (ledger?.payable.length ?? 0)} defaultOpen={showInvoice || (ledger?.overdue.length ?? 0) > 0}>
          {showInvoice && (
            <form className="card stack" onSubmit={(event) => void createInvoice(event)}>
              <p className="kicker">Invoice</p>
              <div>
                <label className="label" htmlFor="iclient">Client @handle</label>
                <div className="field"><input id="iclient" value={client} onChange={(e) => setClient(e.target.value)} placeholder="maya" required /></div>
              </div>
              <div>
                <label className="label" htmlFor="idue">Due</label>
                <div className="field"><input id="idue" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
              </div>
              {lines.map((line, index) => (
                <div key={index} className="line-grid">
                  <div>
                    <label className="label">Description</label>
                    <div className="field"><input value={line.description} onChange={(e) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, description: e.target.value } : row))} required /></div>
                  </div>
                  <div>
                    <label className="label">Qty</label>
                    <div className="field"><input value={line.quantity} inputMode="decimal" onChange={(e) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} /></div>
                  </div>
                  <div>
                    <label className="label">NIM</label>
                    <div className="field"><input value={line.unit} inputMode="decimal" onChange={(e) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, unit: e.target.value } : row))} /></div>
                  </div>
                  <button type="button" className="icon-btn" aria-label="Remove line" disabled={lines.length === 1}
                    onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}>
                    <Icon d="M6 6l12 12M18 6L6 18" />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost" onClick={() => setLines((rows) => [...rows, { description: "", quantity: "1", unit: "" }])}>Add line</button>
              <div>
                <label className="label" htmlFor="inote">Note on the invoice</label>
                <div className="field"><input id="inote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional summary" /></div>
              </div>
              <button className="btn btn-primary btn-block" disabled={busy}>Create invoice</button>
            </form>
          )}

          <InvoiceList title="Overdue" empty="Nothing overdue." rows={ledger?.overdue ?? []} onCopy={onCopy} />
          <InvoiceList title="Due today" empty="Nothing due today." rows={ledger?.dueToday ?? []} onCopy={onCopy} />
          <InvoiceList title="You are owed" empty="No open invoices. Create one or start a timer." rows={ledger?.receivable ?? []} onCopy={onCopy}
            emptyAction={<button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={onTalk}>Ask</button>} />

          <div className="stack">
            <p className="kicker">You owe</p>
            {(ledger?.payable.length ?? 0) === 0 && (ledger?.splitsOwed.length ?? 0) === 0 ? (
              <Empty title="You owe nothing" body="Invoices assigned to you and unpaid splits show up here." />
            ) : (
              <>
                {ledger?.payable.map((row) => (
                  <article key={row.id} className="item">
                    <div className="grow">
                      <strong>{row.invoiceNumber ?? "Invoice"} · @{row.creatorHandle}</strong>
                      <p className="small">{row.note} · {dueLabel(row.dueAt)}</p>
                    </div>
                    <span className="pill info">{formatNim(row.amountLunas)} NIM</span>
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onPayInvoice(row)}>Pay</button>
                  </article>
                ))}
                {ledger?.splitsOwed.map((row) => (
                  <a key={row.id} className="item" href={`/split/${row.splitId}`}>
                    <div className="grow">
                      <strong>Split</strong>
                      <p className="small">{row.note}</p>
                    </div>
                    <span className="pill info">{formatNim(row.shareLunas)} NIM</span>
                  </a>
                ))}
              </>
            )}
          </div>
          </Fold>

          <Fold title="Escrow" count={escrows.length} defaultOpen={escrows.length > 0}>
            <WorkEscrow session={session} escrows={escrows} busy={busy} setBusy={setBusy} notice={notice} onChange={() => void refresh()} />
          </Fold>
        </>
      )}
    </section>
  );
}

function InvoiceList({ title, empty, rows, onCopy, emptyAction }: {
  title: string;
  empty: string;
  rows: InvoiceRow[];
  onCopy: (text: string) => Promise<void> | void;
  emptyAction?: ReactNode;
}) {
  return (
    <div className="stack">
      <p className="kicker">{title}</p>
      {rows.length === 0 ? <Empty title={empty} body="Open invoices you created appear here." action={emptyAction} /> : rows.map((row) => (
        <article key={row.id} className="item">
          <div className="grow">
            <strong>{row.invoiceNumber ?? "Invoice"} · @{row.recipientHandle ?? "client"}</strong>
            <p className="small">{row.note} · {dueLabel(row.dueAt)}</p>
          </div>
          <span className={`pill ${tone(row.status)}`}>{formatNim(row.amountLunas)} NIM</span>
          <a className="btn btn-secondary btn-sm" href={`/request/${row.id}`}>Open</a>
          <button className="btn btn-ghost btn-sm" onClick={() => void onCopy(`${window.location.origin}/request/${row.id}`)}>Copy</button>
        </article>
      ))}
    </div>
  );
}

