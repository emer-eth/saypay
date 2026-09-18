"use client";

import { FormEvent, useState } from "react";
import { formatNim, lunasToNim } from "./_lib/units";
import { api } from "./lib/api";
import { sendNim } from "./lib/wallet";

export type JobStage = {
  id: string;
  title: string;
  amountLunas: number;
  dueAt: string | null;
  status: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  escrowId: string | null;
  escrowStatus: string | null;
};
export type JobRow = {
  id: string;
  title: string;
  status: string;
  iAm: "worker" | "client";
  workerWallet: string;
  clientWallet: string;
  workerHandle: string | null;
  clientHandle: string | null;
  stages: JobStage[];
};

type StageDraft = { title: string; amount: string; dueAt: string };

function tone(status: string) {
  if (/paid|completed/i.test(status)) return "ok";
  if (/cancel|dispute/i.test(status)) return "warn";
  return "info";
}

function stepClass(status: string) {
  if (status === "paid") return "hot";
  if (status === "cancelled") return "bad";
  if (status !== "pending") return "on";
  return "";
}

export function WorkJobs({
  session,
  jobs,
  busy,
  setBusy,
  notice,
  onChange,
}: {
  session: { token: string; handle: string; address: string };
  jobs: JobRow[];
  busy: boolean;
  setBusy: (value: boolean) => void;
  notice: (text: string, tone?: "ok" | "error") => void;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [other, setOther] = useState("");
  const [iAm, setIAm] = useState<"worker" | "client">("worker");
  const [stages, setStages] = useState<StageDraft[]>([
    { title: "Deposit", amount: "", dueAt: "" },
    { title: "Final", amount: "", dueAt: "" },
  ]);
  const [escrowHandle, setEscrowHandle] = useState<Record<string, string>>({});

  async function create(event: FormEvent) {
    event.preventDefault();
    const payloadStages = stages
      .filter((stage) => stage.title.trim() && Number(stage.amount) > 0)
      .map((stage) => ({ title: stage.title.trim(), amount: Number(stage.amount), dueAt: stage.dueAt || undefined }));
    if (!payloadStages.length) {
      notice("Add at least one stage with a name and NIM amount.", "error");
      return;
    }
    setBusy(true);
    try {
      await api("/api/jobs", {
        token: session.token,
        body: { title, otherHandle: other, iAm, stages: payloadStages },
      });
      setTitle("");
      setOther("");
      setStages([{ title: "Deposit", amount: "", dueAt: "" }, { title: "Final", amount: "", dueAt: "" }]);
      setOpen(false);
      notice("Job created. Invoice a stage when work is due — escrow only if you need it.");
      onChange();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Could not create the job.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function act(job: JobRow, action: string, stage?: JobStage) {
    setBusy(true);
    try {
      if (action === "pay" && stage?.invoiceId) {
        notice("Approve the stage payment in Nimiq Pay…");
        const hint = await sendNim({ recipient: job.workerWallet, nim: lunasToNim(stage.amountLunas), note: `${job.title} — ${stage.title}` });
        await api(`/api/requests/${stage.invoiceId}`, { method: "PATCH", token: session.token, body: { transactionHint: hint } });
        notice("Stage paid on-chain.");
        onChange();
        return;
      }
      const extra: Record<string, unknown> = { action, stageId: stage?.id };
      if (action === "start_escrow") extra.escrowHandle = escrowHandle[stage?.id ?? ""] ?? "";
      const result = await api<{ invoice?: { id: string; invoiceNumber: string | null } }>(`/api/jobs/${job.id}`, {
        token: session.token,
        method: "PATCH",
        body: extra,
      });
      if (result.invoice) {
        await navigator.clipboard.writeText(`${window.location.origin}/request/${result.invoice.id}`).catch(() => undefined);
        notice(`${result.invoice.invoiceNumber ?? "Invoice"} for this stage. Link copied.`);
      } else if (action === "request_escrow") {
        notice("Asked the client to escrow this stage.");
      } else if (action === "start_escrow") {
        notice("Escrow offered. The worker names their escrow next, on Work.");
      } else {
        notice("Job updated.");
      }
      onChange();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Could not update the job.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <p className="kicker" style={{ margin: 0 }}>Jobs</p>
        <span className="grow" />
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen((value) => !value)}>{open ? "Close" : "New job"}</button>
      </div>
      <p className="small">Stages of a job. Invoice is the default. Escrow only if you tap it.</p>
      {open && (
        <form className="card stack" onSubmit={(event) => void create(event)}>
          <div>
            <label className="label">Job name</label>
            <div className="field"><input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Landing page" /></div>
          </div>
          <div>
            <label className="label">Other party @handle</label>
            <div className="field"><input value={other} onChange={(e) => setOther(e.target.value)} required placeholder="maya" /></div>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <label className="check">
              <input type="radio" name="iam" checked={iAm === "worker"} onChange={() => setIAm("worker")} />
              I do the work
            </label>
            <label className="check">
              <input type="radio" name="iam" checked={iAm === "client"} onChange={() => setIAm("client")} />
              I am paying
            </label>
          </div>
          {stages.map((stage, index) => (
            <div key={index} className="line-grid" style={{ gridTemplateColumns: "1fr 88px 132px 44px" }}>
              <div>
                <label className="label">Stage</label>
                <div className="field"><input value={stage.title} onChange={(e) => setStages((rows) => rows.map((row, i) => i === index ? { ...row, title: e.target.value } : row))} required /></div>
              </div>
              <div>
                <label className="label">NIM</label>
                <div className="field"><input value={stage.amount} inputMode="decimal" onChange={(e) => setStages((rows) => rows.map((row, i) => i === index ? { ...row, amount: e.target.value } : row))} /></div>
              </div>
              <div>
                <label className="label">Due</label>
                <div className="field"><input type="date" value={stage.dueAt} onChange={(e) => setStages((rows) => rows.map((row, i) => i === index ? { ...row, dueAt: e.target.value } : row))} /></div>
              </div>
              <button type="button" className="icon-btn" aria-label="Remove stage" disabled={stages.length === 1}
                onClick={() => setStages((rows) => rows.filter((_, i) => i !== index))}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={() => setStages((rows) => [...rows, { title: "", amount: "", dueAt: "" }])}>Add stage</button>
          <button className="btn btn-primary btn-block" disabled={busy}>Create job</button>
        </form>
      )}
      {jobs.length === 0 && !open ? (
        <div className="empty"><strong>No jobs</strong><p>Name the work, split it into stages, invoice each one. Escrow is optional.</p></div>
      ) : jobs.map((job) => (
        <article key={job.id} className="card stack">
          <div className="row">
            <strong>{job.title}</strong>
            <span className="grow" />
            <span className={`pill ${tone(job.status)}`}>{job.status.replaceAll("_", " ")}</span>
          </div>
          <p className="small">
            {job.iAm === "worker" ? `Client @${job.clientHandle}` : `Worker @${job.workerHandle}`}
            {" · "}{formatNim(job.stages.reduce((sum, stage) => sum + stage.amountLunas, 0))} NIM
          </p>
          <div className="steps" aria-label="Stages">
            {job.stages.map((stage) => <span key={stage.id} className={stepClass(stage.status)} title={stage.title} />)}
          </div>
          {job.stages.map((stage) => (
            <div key={stage.id} className="item" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <strong>{stage.title}</strong>
                <p className="small">
                  {formatNim(stage.amountLunas)} NIM
                  {stage.dueAt ? ` · due ${new Date(stage.dueAt).toLocaleDateString()}` : ""}
                  {stage.invoiceNumber ? ` · ${stage.invoiceNumber}` : ""}
                </p>
              </div>
              <span className={`pill ${tone(stage.status)}`}>{stage.status.replaceAll("_", " ")}</span>
              <div className="row" style={{ flexWrap: "wrap" }}>
                {job.iAm === "worker" && (stage.status === "pending" || stage.status === "escrow_requested") && (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(job, "invoice_stage", stage)}>Invoice</button>
                )}
                {job.iAm === "worker" && stage.status === "pending" && (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void act(job, "request_escrow", stage)}>Ask for escrow</button>
                )}
                {job.iAm === "client" && stage.status === "invoiced" && stage.invoiceId && (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(job, "pay", stage)}>Pay</button>
                )}
                {job.iAm === "client" && (stage.status === "pending" || stage.status === "escrow_requested") && (
                  <form className="row" style={{ flexWrap: "wrap" }} onSubmit={(event) => { event.preventDefault(); void act(job, "start_escrow", stage); }}>
                    <div className="field" style={{ minWidth: 140 }}>
                      <input value={escrowHandle[stage.id] ?? ""} onChange={(e) => setEscrowHandle((map) => ({ ...map, [stage.id]: e.target.value }))} placeholder="Your escrow @id" required />
                    </div>
                    <button className="btn btn-secondary btn-sm" disabled={busy}>Escrow</button>
                  </form>
                )}
                {stage.invoiceId && (
                  <a className="btn btn-ghost btn-sm" href={`/request/${stage.invoiceId}`}>Open invoice</a>
                )}
              </div>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}
