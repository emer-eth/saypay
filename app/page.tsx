"use client";

import { FormEvent, useMemo, useState } from "react";

type Flow = "send" | "split" | "invoice" | "protect";

const flows: Record<
  Flow,
  { label: string; icon: string; prompt: string; title: string; detail: string; asset: string }
> = {
  send: {
    label: "Send money",
    icon: "↗",
    prompt: "Send 20 NIM to Mum for groceries",
    title: "Send 20 NIM",
    detail: "Mum · Groceries",
    asset: "NIM",
  },
  split: {
    label: "Split a bill",
    icon: "◌",
    prompt: "Split 120 NIM dinner with Ada and Tunde",
    title: "Split 120 NIM",
    detail: "You, Ada, Tunde · 40 NIM each",
    asset: "NIM",
  },
  invoice: {
    label: "Create invoice",
    icon: "□",
    prompt: "Create a 300 USDT invoice for website design",
    title: "Invoice for 300 USDT",
    detail: "Website design · Share when ready",
    asset: "USDT",
  },
  protect: {
    label: "Protected Pay",
    icon: "◇",
    prompt: "Pay Ada 80 USDT after logo delivery, with three arbiters",
    title: "Protect 80 USDT",
    detail: "Logo design · Release by Friday",
    asset: "USDT",
  },
};

export default function Home() {
  const [flow, setFlow] = useState<Flow>("send");
  const [message, setMessage] = useState(flows.send.prompt);
  const [reviewing, setReviewing] = useState(false);
  const [done, setDone] = useState(false);
  const [tab, setTab] = useState<"home" | "activity" | "protect">("home");

  const active = useMemo(() => flows[flow], [flow]);

  function pickFlow(next: Flow) {
    setFlow(next);
    setMessage(flows[next].prompt);
    setReviewing(false);
    setDone(false);
    setTab(next === "protect" ? "protect" : "home");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.toLowerCase();
    const next: Flow = text.includes("protect") || text.includes("delivery") || text.includes("arbiter")
      ? "protect"
      : text.includes("split")
        ? "split"
        : text.includes("invoice")
          ? "invoice"
          : "send";
    setFlow(next);
    setTab(next === "protect" ? "protect" : "home");
    setReviewing(true);
    setDone(false);
  }

  return (
    <main className="app-shell">
      <section className="app-frame" aria-label="SayPay payment assistant">
        <header className="topbar">
          <div className="brand">SayPay</div>
          <button className="profile" aria-label="Open profile">◉</button>
        </header>

        {tab === "activity" ? (
          <Activity onReturn={() => setTab("home")} />
        ) : tab === "protect" ? (
          <Protected active={active} reviewing={reviewing} done={done} onReview={() => setReviewing(true)} onConfirm={() => setDone(true)} />
        ) : (
          <section className="home-view">
            <div className="intro">
              <p className="eyebrow">PAYMENTS IN PLAIN LANGUAGE</p>
              <h1>What would you like to do?</h1>
              <p>Say it naturally. You always review before money moves.</p>
            </div>

            <div className="quick-grid" aria-label="Quick actions">
              {(Object.keys(flows) as Flow[]).map((key) => (
                <button className={`quick-action ${flow === key ? "selected" : ""}`} key={key} onClick={() => pickFlow(key)}>
                  <span className={`action-icon ${key}`}>{flows[key].icon}</span>
                  <span>{flows[key].label}</span>
                </button>
              ))}
            </div>

            <div className="conversation">
              <div className="assistant-line"><span className="spark">✦</span> I turned your words into a clear plan.</div>
              <div className="user-message">{message}</div>
              <ActionCard flow={flow} reviewing={reviewing} done={done} onReview={() => setReviewing(true)} onConfirm={() => setDone(true)} />
            </div>

            <form className="composer" onSubmit={submit}>
              <input aria-label="Describe a payment" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Say something..." />
              <button type="button" className="mic" aria-label="Use voice input">⌁</button>
              <button type="submit" className="send" aria-label="Create payment plan">↑</button>
            </form>
          </section>
        )}

        <nav className="bottom-nav" aria-label="Main navigation">
          <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}><span>⌂</span>Home</button>
          <button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}><span>☷</span>Activity</button>
          <button className={tab === "protect" ? "active" : ""} onClick={() => setTab("protect")}><span>◇</span>Protect</button>
        </nav>
      </section>
    </main>
  );
}

function ActionCard({ flow, reviewing, done, onReview, onConfirm }: { flow: Flow; reviewing: boolean; done: boolean; onReview: () => void; onConfirm: () => void }) {
  const item = flows[flow];
  const primary = flow === "invoice" ? "Create invoice" : flow === "protect" ? "Review deal" : "Review payment";
  const confirmed = flow === "invoice" ? "Invoice link ready" : flow === "protect" ? "Deal ready to fund" : "Ready for Nimiq Pay";

  return (
    <article className={`action-card ${flow}`}>
      <div className="card-heading">
        <span className="card-symbol">{flow === "protect" ? "◇" : flow === "invoice" ? "□" : flow === "split" ? "◌" : "↗"}</span>
        <div><p>{flow === "protect" ? "Protected Pay" : "Payment plan"}</p><h2>{item.title}</h2></div>
      </div>
      <div className="card-row"><span>{flow === "split" ? "People" : flow === "invoice" ? "For" : flow === "protect" ? "Milestone" : "To"}</span><strong>{flow === "split" ? "Ada · Tunde" : flow === "invoice" ? "Website design" : flow === "protect" ? "Logo delivery" : "Mum"}</strong></div>
      <div className="card-row"><span>Note</span><strong>{item.detail}</strong></div>
      {flow === "protect" && <div className="arbiters"><span>Trusted arbiters</span><div className="faces"><i>AM</i><i>BK</i><i>CN</i></div></div>}
      {done ? (
        <div className="success"><span>✓</span>{confirmed}</div>
      ) : reviewing ? (
        <button className="primary" onClick={onConfirm}>{flow === "invoice" ? "Create secure link" : "Confirm in Nimiq Pay"}</button>
      ) : (
        <button className="primary" onClick={onReview}>{primary}</button>
      )}
      <p className="safety">⌁ You always confirm in Nimiq Pay.</p>
    </article>
  );
}

function Protected({ active, reviewing, done, onReview, onConfirm }: { active: (typeof flows)[Flow]; reviewing: boolean; done: boolean; onReview: () => void; onConfirm: () => void }) {
  return <section className="protect-view"><div className="protect-title"><p className="eyebrow">PAY WITH CONFIDENCE</p><h1>Protected Pay</h1><p>Lock a deal, then release when both sides agree.</p></div><div className="funds-pill">✓ Funds protected by clear terms</div><ActionCard flow="protect" reviewing={reviewing} done={done} onReview={onReview} onConfirm={onConfirm} /><section className="timeline"><p>HOW IT WORKS</p><div><b>1</b><span>Both sides accept the terms</span></div><div><b>2</b><span>Funds are locked securely</span></div><div><b>3</b><span>Release, refund, or settle with arbiters</span></div></section></section>;
}

function Activity({ onReturn }: { onReturn: () => void }) {
  return <section className="activity-view"><div className="intro"><p className="eyebrow">YOUR MONEY, CLEARLY</p><h1>Activity</h1><p>Every payment, request, and agreement in one place.</p></div><div className="activity-list"><article><span className="activity-icon green">↗</span><div><strong>Groceries for Mum</strong><p>Completed today</p></div><b>20 NIM</b></article><article><span className="activity-icon blue">□</span><div><strong>Website design invoice</strong><p>Waiting for Ada</p></div><b>300 USDT</b></article><article><span className="activity-icon amber">◇</span><div><strong>Logo design deal</strong><p>Delivery pending</p></div><b>80 USDT</b></article></div><button className="outline" onClick={onReturn}>Create a payment</button></section>;
}
